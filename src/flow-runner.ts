import { randomUUID } from 'node:crypto';
import type {
  FlowDefinition,
  FlowError,
  FlowInstance,
  FlowNode,
  Goal,
  NodeRun,
  RunResult,
  UnitStatus,
  WorkContext,
} from './model.js';
import { entryNodeIds, nodeIndex, resolveNextTargets, validateFlowDefinition } from './graph.js';
import type { NodeExecutor } from './runtime.js';
import { succeeded } from './result.js';

export type FlowRunnerOptions = {
  id?: string;
  definition: FlowDefinition;
  goal: Goal;
  context?: WorkContext;
  executor: NodeExecutor;
  now?: () => Date;
  onChange?: (instance: FlowInstance) => void;
};

export class FlowRunner implements FlowInstance {
  readonly id: string;
  readonly flow: { id: string; version: string };
  readonly goal: Goal;
  readonly context: WorkContext;
  readonly steps: NodeRun[] = [];
  readonly createdAt: string;

  status: UnitStatus = 'running';
  result?: RunResult;
  updatedAt: string;

  private readonly definition: FlowDefinition;
  private readonly nodes: Map<string, FlowNode>;
  private readonly executor: NodeExecutor;
  private readonly now: () => Date;
  private readonly onChange?: (instance: FlowInstance) => void;
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly inFlight = new Map<string, symbol>();
  private readonly terminalResults: RunResult[] = [];
  private readonly outputs = new Map<string, unknown>();
  private active = 0;
  private pumping = false;
  private completed = false;
  private onComplete?: () => void;
  private execution?: Promise<RunResult>;

  constructor(options: FlowRunnerOptions) {
    validateFlowDefinition(options.definition);
    this.id = options.id ?? randomUUID();
    this.flow = { id: options.definition.id, version: options.definition.version };
    this.goal = options.goal;
    this.context = options.context ?? {};
    this.definition = options.definition;
    this.nodes = nodeIndex(options.definition);
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
    this.onChange = options.onChange;
    this.createdAt = this.now().toISOString();
    this.updatedAt = this.createdAt;
  }

  execute(): Promise<RunResult> {
    this.execution ??= this.run();
    return this.execution;
  }

  private async run(): Promise<RunResult> {
    if (this.result) {
      return this.result;
    }

    this.status = 'running';
    this.touch();

    const completion = new Promise<void>((resolve) => {
      this.onComplete = resolve;
    });

    for (const nodeId of entryNodeIds(this.definition)) {
      this.enqueue(nodeId);
    }
    this.checkDone();

    await completion;
    return this.result ?? succeeded();
  }

  private enqueue(nodeId: string): void {
    if (this.status !== 'running' || this.inFlight.has(nodeId) || this.queued.has(nodeId)) {
      return;
    }
    this.queued.add(nodeId);
    this.queue.push(nodeId);
    this.pump();
  }

  private pump(): void {
    if (this.pumping) {
      return;
    }
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.status === 'running') {
        const nodeId = this.queue.shift()!;
        this.queued.delete(nodeId);
        if (this.inFlight.has(nodeId)) {
          continue;
        }
        const token = Symbol(nodeId);
        this.inFlight.set(nodeId, token);
        this.active += 1;
        void this.executeNode(nodeId, token);
      }
    } finally {
      this.pumping = false;
    }
  }

  private checkDone(): void {
    if (this.completed) {
      return;
    }
    if (this.status === 'running' && this.active === 0 && this.queue.length === 0) {
      this.finalize();
    }
    if ((this.status === 'ended' || this.status === 'paused') && this.active === 0) {
      this.completed = true;
      this.onComplete?.();
    }
  }

  private async executeNode(nodeId: string, token: symbol): Promise<void> {
    try {
      await this.executeNodeInner(nodeId);
    } finally {
      if (this.inFlight.get(nodeId) === token) {
        this.inFlight.delete(nodeId);
      }
      this.active -= 1;
      this.checkDone();
    }
  }

  private async executeNodeInner(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.pause({ code: 'flow.node.missing', message: `node "${nodeId}" does not exist` });
      return;
    }

    const run: NodeRun = {
      nodeId,
      type: node.type,
      status: 'running',
      startedAt: this.now().toISOString(),
    };
    this.steps.push(run);
    this.touch();

    let outcome: RunResult;
    try {
      outcome = await this.executor.execute(node, {
        flowInstanceId: this.id,
        goal: this.goal,
        context: this.context,
        outputs: Object.fromEntries(this.outputs),
      });
    } catch (error) {
      this.inFlight.delete(nodeId);
      const flowError: FlowError = {
        code: 'node.execution.error',
        message: error instanceof Error ? error.message : String(error),
      };
      this.completeRun(run, { outcome: { status: 'failed' }, error: flowError });
      this.pause(flowError);
      return;
    }

    this.completeRun(run, outcome);
    this.inFlight.delete(nodeId);

    if (this.status !== 'running') {
      return;
    }

    if (outcome.outcome.status !== 'succeeded' || outcome.error) {
      const error =
        outcome.error ??
        ({
          code: `node.${outcome.outcome.status}`,
          message: `node "${nodeId}" ended with ${outcome.outcome.status}`,
        } satisfies FlowError);
      run.error = error;
      const routed = resolveNextTargets(node.next, error.code, 'failure');

      if (!routed.ok || routed.targets.length === 0) {
        this.pause(error);
        return;
      }

      for (const target of routed.targets) {
        this.enqueue(target);
      }
      return;
    }

    const routed = resolveNextTargets(node.next, outcome.label, 'positive');
    if (!routed.ok) {
      this.pause({
        code: 'flow.route.missing',
        message: `no next entry for label "${outcome.label ?? ''}" on node "${nodeId}"`,
      });
      return;
    }

    if (routed.targets.length === 0) {
      this.terminalResults.push(outcome);
      return;
    }

    for (const target of routed.targets) {
      this.enqueue(target);
    }
  }

  private completeRun(run: NodeRun, outcome: RunResult): void {
    run.outcome = outcome.outcome;
    run.label = outcome.label;
    run.error = outcome.error;
    run.output = outcome.output;
    run.status = 'ended';
    run.finishedAt = this.now().toISOString();
    if (outcome.output !== undefined) {
      this.outputs.set(run.nodeId, outcome.output);
    }
    this.touch();
  }

  private pause(error: FlowError): void {
    if (this.status !== 'running') {
      return;
    }
    this.status = 'paused';
    this.result = { outcome: { status: 'failed' }, error };
    this.touch();
    this.checkDone();
  }

  private finalize(): void {
    this.status = 'ended';
    this.result = this.terminalResults.at(-1) ?? succeeded();
    this.touch();
  }

  private touch(): void {
    this.updatedAt = this.now().toISOString();
    this.onChange?.(this);
  }
}
