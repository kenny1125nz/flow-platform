import { TIER_ORDER, type AgentTier, type FlowNode, type HumanTier, type RunResult, type ScriptTier, type Tier, type TierKind, type TierRun } from './model.js';
import { barFor, resolveTierConfig, type FlowPolicy, type ResolvedTierConfig } from './policy.js';
import { failed } from './result.js';
import type { StatsStore } from './stats.js';
import type { NodeContext } from './runtime.js';

export type TierHandlers = {
  script: (tier: ScriptTier, context: NodeContext) => Promise<RunResult>;
  agent: (tier: AgentTier, context: NodeContext) => Promise<RunResult>;
  human: (tier: HumanTier, context: NodeContext) => Promise<RunResult>;
};

export type NodeExecution = {
  result: RunResult;
  tiers: TierRun[];
};

export type CascadeOptions = {
  handlers: TierHandlers;
  policy?: FlowPolicy;                              // fixed policy (fallback)
  resolvePolicy?: (flow: { id: string; version: string }) => FlowPolicy | undefined;
  stats?: StatsStore;
  now?: () => Date;
  random?: () => number;
};

// The executor that realizes "every node is the joint effort of script, agent, and
// human". It runs the node's tier stack in canonical order, accepts the first tier whose
// output meets its confidence bar, and escalates otherwise — until the human anchor, the
// last resort. Delegation and sampling are decided per run from the runtime statistics.
export function createCascadeExecutor(options: CascadeOptions) {
  const policy = options.policy;
  const resolvePolicy = options.resolvePolicy;
  const stats = options.stats;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;

  return {
    async execute(node: FlowNode, context: NodeContext): Promise<NodeExecution> {
      const resolved = resolvePolicy?.(context.flow) ?? policy ?? DEFAULT_FALLBACK;
      const config = resolveTierConfig(node, resolved);
      const activeKinds = selectTierKinds(node, context, resolved, config, stats, random);

      const tiers = node.tiers
        .filter((tier) => activeKinds.includes(tier.kind))
        .sort((a, b) => TIER_ORDER.indexOf(a.kind) - TIER_ORDER.indexOf(b.kind));

      const trace: TierRun[] = [];
      let accepted: { result: RunResult; index: number } | null = null;
      let lastError = undefined as { code: string; message?: string } | undefined;

      for (let index = 0; index < tiers.length; index += 1) {
        const tier = tiers[index];
        const tierRun: TierRun = { kind: tier.kind, status: 'running', startedAt: now().toISOString() };
        trace.push(tierRun);
        context.reportTier?.(tierRun);

        const binding = config.binding[tier.kind] ?? true;
        let result: RunResult;
        try {
          result = await runTier(options.handlers, tier, context);
        } catch (error) {
          result = failed({
            code: `tier.${tier.kind}.error`,
            message: error instanceof Error ? error.message : String(error),
          });
        }

        tierRun.outcome = result.outcome.status;
        tierRun.label = result.label;
        tierRun.output = result.output;
        tierRun.confidence = result.confidence;
        tierRun.coverage = result.coverage;
        tierRun.error = result.error;
        tierRun.finishedAt = now().toISOString();
        tierRun.status = 'ended';
        tierRun.escalated = false;

        if (!binding) {
          tierRun.advisory = true;
          tierRun.escalated = true;
          lastError ??= { code: 'tier.advisory', message: `tier ${tier.kind} is advisory` };
          context.reportTier?.(tierRun);
          continue;
        }

        const meetsBar = tierMeetsBar(tier.kind, result, config, resolved);
        if (!meetsBar) {
          tierRun.escalated = true;
          lastError = result.error ?? {
            code: `tier.${tier.kind}.confidence`,
            message: `confidence ${result.confidence ?? 'not reported'} is below the acceptance bar`,
          };
          context.reportTier?.(tierRun);
          continue;
        }

        // The tier met its bar. If an earlier tier already did (sampling run), the higher
        // tier only overrides on disagreement — otherwise the earlier verdict stands.
        if (accepted === null) {
          accepted = { result, index };
        } else {
          tierRun.sampled = true;
          if (disagrees(trace[accepted.index], tierRun)) {
            accepted = { result, index };
          }
        }
        context.reportTier?.(tierRun);
      }

      stats?.record(context.flow, node, trace);

      if (accepted !== null) {
        return { result: accepted.result, tiers: trace };
      }
      return {
        result: failed(
          lastError ?? { code: 'node.no.tier', message: 'no tier produced a result' },
        ),
        tiers: trace,
      };
    },
  };
}

async function runTier(handlers: TierHandlers, tier: Tier, context: NodeContext): Promise<RunResult> {
  switch (tier.kind) {
    case 'script':
      return handlers.script(tier, context);
    case 'agent':
      return handlers.agent(tier, context);
    case 'human':
      return handlers.human(tier, context);
  }
}

// Decides which tiers participate in this run. The node's stack minus the human tier,
// when the stats show the tier below human has been agreeing with the human anchor — and
// minus a random sample of those delegations, so calibration data keeps flowing.
function selectTierKinds(
  node: FlowNode,
  context: NodeContext,
  policy: FlowPolicy,
  config: ResolvedTierConfig,
  stats: StatsStore | undefined,
  random: () => number,
): TierKind[] {
  const kinds = node.tiers.map((tier) => tier.kind);
  if (!kinds.includes('human') || kinds.length < 2) {
    return kinds;
  }
  if (!stats) {
    return kinds;
  }

  const decision = stats.delegateDecision(context.flow, node, config.delegation);
  if (decision !== 'delegate') {
    return kinds;
  }
  if (random() < config.delegation.sampling) {
    return kinds;
  }
  return kinds.filter((kind) => kind !== 'human');
}

function tierMeetsBar(
  kind: TierKind,
  result: RunResult,
  config: ResolvedTierConfig,
  policy: FlowPolicy,
): boolean {
  if (result.error !== undefined) {
    return false;
  }
  if (result.confidence === undefined) {
    // No self-reported confidence: the tier's outcome is trusted as-is. The human anchor
    // always qualifies; it is the last resort, not a probability.
    return true;
  }
  return result.confidence >= barFor(config, policy, kind);
}

// Two accepted verdicts disagree when they differ in outcome or (when both name labels)
// in label.
function disagrees(a: TierRun, b: TierRun): boolean {
  if (a.outcome !== b.outcome) {
    return true;
  }
  if (a.label !== undefined && b.label !== undefined) {
    return a.label !== b.label;
  }
  return false;
}

const DEFAULT_FALLBACK: FlowPolicy = {
  id: 'default',
  version: '1',
  qualityBar: 0.8,
  config: { bar: {}, binding: {} },
  delegation: { agreement: 0.9, minSamples: 5, sampling: 0.2 },
  rules: [],
};

export type CascadeExecutor = ReturnType<typeof createCascadeExecutor>;
