import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentNode,
  FlowError,
  FlowNode,
  Goal,
  HumanNode,
  OutcomeStatus,
  RunResult,
  ScriptNode,
  WorkContext,
} from './model.js';
import { failed, succeeded } from './result.js';

const execAsync = promisify(exec);

export type NodeContext = {
  flowInstanceId: string;
  goal: Goal;
  context: WorkContext;
  outputs: Readonly<Record<string, unknown>>;
};

export type NodeHandler<T extends FlowNode = FlowNode> = (
  node: T,
  context: NodeContext,
) => Promise<RunResult>;

export type NodeHandlers = {
  human: NodeHandler<HumanNode>;
  agent: NodeHandler<AgentNode>;
  script: NodeHandler<ScriptNode>;
};

export interface NodeExecutor {
  execute(node: FlowNode, context: NodeContext): Promise<RunResult>;
}

export function createNodeExecutor(handlers: Partial<NodeHandlers> = {}): NodeExecutor {
  const resolved: NodeHandlers = {
    human:
      handlers.human ??
      (async () => {
        throw new Error('no human handler configured');
      }),
    agent:
      handlers.agent ??
      (async () => {
        throw new Error('no agent handler configured');
      }),
    script: handlers.script ?? localScriptHandler,
  };

  return {
    execute(node, context) {
      switch (node.type) {
        case 'human':
          return resolved.human(node, context);
        case 'agent':
          return resolved.agent(node, context);
        case 'script':
          return resolved.script(node, context);
      }
    },
  };
}

export const localScriptHandler: NodeHandler<ScriptNode> = async (node, context) => {
  const env = {
    ...process.env,
    FLOW_INSTANCE_ID: context.flowInstanceId,
    FLOW_GOAL: JSON.stringify(context.goal),
    FLOW_CONTEXT: JSON.stringify(context.context),
    FLOW_ARGS: JSON.stringify(node.args ?? {}),
    FLOW_OUTPUTS: JSON.stringify(context.outputs),
  };

  try {
    const { stdout } = await execAsync(node.run, { env });
    return parseScriptResult(stdout) ?? succeeded();
  } catch (error) {
    return failed({
      code: 'script.failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

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
      const result = toRunResult(JSON.parse(candidate));
      if (result) {
        return result;
      }
    } catch {
      // keep scanning upward
    }
  }

  return null;
}

function toRunResult(value: unknown): RunResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!('outcome' in record) && !('label' in record) && !('error' in record)) {
    return null;
  }

  const error = normalizeError(record.error);
  const outcome = normalizeOutcome(record.outcome, error);
  const label = typeof record.label === 'string' ? record.label : undefined;
  const output = 'output' in record ? record.output : undefined;

  return {
    outcome: { status: outcome },
    ...(label === undefined ? {} : { label }),
    ...(error === undefined ? {} : { error }),
    ...(output === undefined ? {} : { output }),
  };
}

function normalizeOutcome(value: unknown, error: FlowError | undefined): OutcomeStatus {
  if (value === 'succeeded' || value === 'failed' || value === 'cancelled') {
    return value;
  }
  return error ? 'failed' : 'succeeded';
}

function normalizeError(value: unknown): FlowError | undefined {
  if (typeof value === 'string') {
    return { code: 'script.error', message: value };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : 'script.error';
  const message = typeof record.message === 'string' ? record.message : undefined;
  const hint = typeof record.hint === 'string' ? record.hint : undefined;

  return {
    code,
    ...(message === undefined ? {} : { message }),
    ...(hint === undefined ? {} : { hint }),
  };
}

type PendingHumanTask = {
  resolve: (result: RunResult) => void;
};

export class HumanTaskBroker {
  private readonly pendingTasks = new Map<string, PendingHumanTask>();

  readonly handler: NodeHandler<HumanNode> = (node, context) =>
    this.wait(context.flowInstanceId, node.id);

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
