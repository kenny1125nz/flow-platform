import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  FlowNode,
  Goal,
  HumanTier,
  RunResult,
  ScriptTier,
  Tier,
  TierRun,
  WorkContext,
} from './model.js';
import { toRunResult } from './parse-result.js';
import { failed, succeeded } from './result.js';
import { createCascadeExecutor, type CascadeOptions, type NodeExecution, type TierHandlers } from './cascade.js';
import type { StatsStore } from './stats.js';

const execAsync = promisify(exec);

export type NodeContext = {
  flowInstanceId: string;
  nodeId: string;
  flow: { id: string; version: string };
  goal: Goal;
  context: WorkContext;
  outputs: Readonly<Record<string, unknown>>;
  // Live reporting of tier progress, so the run's step history reflects which tier is
  // active while the node is still executing (e.g. a pending human tier).
  reportTier?: (tier: TierRun) => void;
};

export type TierHandler<T extends Tier = Tier> = (
  tier: T,
  context: NodeContext,
) => Promise<RunResult>;

export interface NodeExecutor {
  execute(node: FlowNode, context: NodeContext): Promise<NodeExecution>;
}

export type CreateNodeExecutorOptions = Pick<CascadeOptions, 'policy' | 'resolvePolicy' | 'stats' | 'now' | 'random'>;

export function createNodeExecutor(
  handlers: Partial<TierHandlers> = {},
  options: CreateNodeExecutorOptions = {},
): NodeExecutor {
  const resolved: TierHandlers = {
    script: handlers.script ?? localScriptHandler,
    agent:
      handlers.agent ??
      (async () => {
        throw new Error('no agent handler configured');
      }),
    human:
      handlers.human ??
      (async () => {
        throw new Error('no human handler configured');
      }),
  };

  return createCascadeExecutor({
    handlers: resolved,
    policy: options.policy,
    resolvePolicy: options.resolvePolicy,
    stats: options.stats,
    now: options.now,
    random: options.random,
  });
}

export const localScriptHandler: TierHandler<ScriptTier> = async (tier, context) => {
  const env = {
    ...process.env,
    FLOW_INSTANCE_ID: context.flowInstanceId,
    FLOW_GOAL: JSON.stringify(context.goal),
    FLOW_CONTEXT: JSON.stringify(context.context),
    FLOW_ARGS: JSON.stringify(tier.args ?? {}),
    FLOW_OUTPUTS: JSON.stringify(context.outputs),
  };

  try {
    const { stdout, stderr } = await execAsync(tier.run, { env });
    return withLogs(parseScriptResult(stdout) ?? succeeded(), stdout, stderr);
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string };
    return withLogs(
      failed({
        code: 'script.failed',
        message: failure.message ?? String(error),
      }),
      failure.stdout ?? '',
      failure.stderr ?? '',
    );
  }
};

function withLogs(result: RunResult, stdout: string, stderr: string): RunResult {
  return {
    ...result,
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
  };
}

function parseScriptResult(stdout: string): RunResult | null {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');

  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const candidate = lines
      .slice(start)
      .join('\n')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    if (!candidate.startsWith('{')) {
      continue;
    }
    try {
      const result = toRunResult(JSON.parse(candidate), 'script.error');
      if (result) {
        return result;
      }
    } catch {
      // keep scanning upward
    }
  }

  return null;
}

type PendingHumanTask = {
  resolve: (result: RunResult) => void;
};

export class HumanTaskBroker {
  private readonly pendingTasks = new Map<string, PendingHumanTask>();

  readonly handler = (tier: HumanTier, context: NodeContext): Promise<RunResult> =>
    this.wait(context.flowInstanceId, context.nodeId);

  wait(flowInstanceId: string, nodeId: string): Promise<RunResult> {
    const key = taskKey(flowInstanceId, nodeId);
    if (this.pendingTasks.has(key)) {
      return Promise.reject(new Error(`human task already pending: ${key}`));
    }

    return new Promise<RunResult>((resolve) => {
      this.pendingTasks.set(key, { resolve });
    });
  }

  respond(flowInstanceId: string, nodeId: string, result: RunResult): boolean {
    return this.respondByKey(taskKey(flowInstanceId, nodeId), result);
  }

  respondByKey(key: string, result: RunResult): boolean {
    const task = this.pendingTasks.get(key);
    if (!task) {
      return false;
    }
    this.pendingTasks.delete(key);
    task.resolve(result);
    return true;
  }

  pending(): string[] {
    return [...this.pendingTasks.keys()];
  }
}

function taskKey(flowInstanceId: string, nodeId: string): string {
  return `${flowInstanceId}:${nodeId}`;
}
