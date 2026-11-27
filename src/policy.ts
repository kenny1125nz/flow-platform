import type { TierKind } from './model.js';

// The dynamic half of a node's execution. The definition declares the tier stack; the
// policy decides how those tiers cooperate today: the acceptance bar per tier, whether a
// tier's verdict is binding, and how far the human tier may be delegated away. Policy is
// data and changes far more often than definitions — raising a confidence bar never
// requires a new definition version.
export type TierConfig = {
  // Minimum confidence a tier's output must report to be accepted (0..1). When a tier
  // reports no confidence, its outcome is trusted as-is; the bar applies only to tiers
  // that report one.
  bar: Partial<Record<TierKind, number>>;
  // When false, the tier runs but its verdict is advisory only — it never finalizes the
  // node, and the cascade continues to the next tier.
  binding: Partial<Record<TierKind, boolean>>;
};

export type DelegationConfig = {
  // Minimum share of cases where the tier below human agreed with the human anchor
  // before the human tier may be dropped.
  agreement: number;
  // Minimum number of agreement samples required before delegation may apply.
  minSamples: number;
  // Probability (0..1) that the human tier still runs for calibration after delegation
  // has kicked in. Without sampling, delegated verdicts are never checked again.
  sampling: number;
};

export type PolicyRule = {
  // Matched against node annotations; first matching rule wins.
  when: Record<string, string>;
  config: Partial<TierConfig>;
  delegation?: Partial<DelegationConfig>;
};

export type FlowPolicy = {
  id: string;
  version: string;
  // Default acceptance bar for tiers without an explicit per-tier bar.
  qualityBar: number;
  config: TierConfig;
  delegation: DelegationConfig;
  rules: PolicyRule[];
};

export const DEFAULT_POLICY: Omit<FlowPolicy, 'id' | 'version'> = {
  qualityBar: 0.8,
  config: {
    bar: {},
    binding: {},
  },
  delegation: {
    agreement: 0.9,
    minSamples: 5,
    sampling: 0.2,
  },
  rules: [],
};

export function makePolicy(id: string, version: string, overrides: Partial<FlowPolicy> = {}): FlowPolicy {
  return {
    id,
    version,
    qualityBar: overrides.qualityBar ?? DEFAULT_POLICY.qualityBar,
    config: {
      bar: { ...(overrides.config?.bar ?? {}) },
      binding: { ...(overrides.config?.binding ?? {}) },
    },
    delegation: { ...DEFAULT_POLICY.delegation, ...(overrides.delegation ?? {}) },
    rules: [...(overrides.rules ?? [])],
  };
}

export function matchesAnnotations(
  node: { annotations?: Record<string, string> },
  when: Record<string, string>,
): boolean {
  const annotations = node.annotations ?? {};
  return Object.entries(when).every(([key, value]) => annotations[key] === value);
}

export type ResolvedTierConfig = {
  bar: Partial<Record<TierKind, number>>;
  binding: Partial<Record<TierKind, boolean>>;
  delegation: DelegationConfig;
};

// Resolves the effective tier config for a node: the policy default, overlaid by the
// first rule whose `when` matches the node's annotations.
export function resolveTierConfig(node: { annotations?: Record<string, string> }, policy: FlowPolicy): ResolvedTierConfig {
  let bar: Partial<Record<TierKind, number>> = { ...policy.config.bar };
  let binding: Partial<Record<TierKind, boolean>> = { ...policy.config.binding };
  let delegation: DelegationConfig = { ...policy.delegation };

  for (const rule of policy.rules) {
    if (matchesAnnotations(node, rule.when)) {
      bar = { ...bar, ...(rule.config?.bar ?? {}) };
      binding = { ...binding, ...(rule.config?.binding ?? {}) };
      delegation = { ...delegation, ...(rule.delegation ?? {}) };
      break;
    }
  }

  return { bar, binding, delegation };
}

export function barFor(config: ResolvedTierConfig, policy: FlowPolicy, kind: TierKind): number {
  return config.bar[kind] ?? policy.qualityBar;
}

// In-memory store of flow policies, keyed by flow id@version. The default policy applies
// to any flow without a stored policy.
export class PolicyStore {
  private readonly policies = new Map<string, FlowPolicy>();

  put(policy: FlowPolicy): void {
    this.policies.set(policyKey(policy.id, policy.version), policy);
  }

  get(id: string, version: string): FlowPolicy | undefined {
    return this.policies.get(policyKey(id, version));
  }

  list(): FlowPolicy[] {
    return [...this.policies.values()];
  }

  delete(id: string, version: string): boolean {
    return this.policies.delete(policyKey(id, version));
  }
}

export function policyKey(id: string, version: string): string {
  return `${id}@${version}`;
}
