import { randomUUID } from 'node:crypto';
import type {
  FlowDefinition,
  FlowError,
  FlowInstance,
  FlowNode,
  Goal,
  NodeRun,
  RunResult,
  TierRun,
  UnitStatus,
  WorkContext,
} from './model.js';
import { entryNodeIds, nodeIndex, resolveNextTargets, validateFlowDefinition } from './graph.js';
import { OperatorActionError } from './errors.js';
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
  // Rehydrates a runner from a persisted run so a paused run can be operated on after a
  // restart. Restored runs keep their history and resume from an explicit operator action.
  restore?: {
    steps: NodeRun[];
    status?: UnitStatus;
    suspended?: boolean;
    result?: RunResult;
    createdAt?: string;
    updatedAt?: string;
  };
};

export class FlowRunner implements FlowInstance {
  readonly id: string;
  readonly flow: { id: string; version: string };
  readonly goal: Goal;
  readonly context: WorkContext;
  readonly steps: NodeRun[] = [];
  readonly createdAt: string;

  status: UnitStatus = 'running';
  suspended = false;
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
  private readonly tierRuns = new Map<string, Map<string, TierRun>>();
  // Set by retryStep so the next execution reuses the reset step record instead of
  // appending a duplicate attempt.
  private retryRun?: { nodeId: string; run: NodeRun };
  private active = 0;
  private pumping = false;
  private completed = false;
  private cancelled = false;
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
    this.createdAt = options.restore?.createdAt ?? this.now().toISOString();
    this.updatedAt = options.restore?.updatedAt ?? this.createdAt;

    if (options.restore) {
      this.status = options.restore.status ?? this.status;
      this.suspended = options.restore.suspended ?? this.suspended;
      this.result = options.restore.result;
      for (const step of options.restore.steps) {
        this.steps.push(step);
        if (step.output !== undefined) {
          this.outputs.set(step.nodeId, step.output);
        }
      }
    }
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
    if (this.cancelled || this.status !== 'running' || this.inFlight.has(nodeId) || this.queued.has(nodeId)) {
      return;
    }
    this.queued.add(nodeId);
    this.queue.push(nodeId);
    this.pump();
  }

  private pump(): void {
    if (this.pumping || this.suspended || this.cancelled) {
      return;
    }
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.status === 'running' && !this.suspended && !this.cancelled) {
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
    if (this.completed || this.suspended || this.cancelled) {
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
      this.pauseError({ code: 'flow.node.missing', message: `node "${nodeId}" does not exist` });
      return;
    }

    const retry = this.retryRun?.nodeId === nodeId ? this.retryRun.run : undefined;
    this.retryRun = undefined;
    const run: NodeRun = retry ?? {
      nodeId,
      status: 'running',
      tiers: [],
      startedAt: this.now().toISOString(),
    };
    if (!retry) {
      this.steps.push(run);
    }
    this.tierRuns.set(nodeId, new Map());
    this.touch();

    let outcome: RunResult;
    let tierTrace: TierRun[];
    try {
      const execution = await this.executor.execute(node, {
        flowInstanceId: this.id,
        nodeId,
        flow: this.flow,
        goal: this.goal,
        context: this.context,
        outputs: Object.fromEntries(this.outputs),
        reportTier: (tierRun) => this.reportTier(nodeId, run, tierRun),
      });
      outcome = execution.result;
      tierTrace = execution.tiers;
    } catch (error) {
      this.inFlight.delete(nodeId);
      const flowError: FlowError = {
        code: 'node.execution.error',
        message: error instanceof Error ? error.message : String(error),
      };
      this.completeRun(run, { outcome: { status: 'failed' }, error: flowError }, run.tiers);
      this.pauseError(flowError);
      return;
    }

    this.completeRun(run, outcome, tierTrace);
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
        this.pauseError(error);
        return;
      }

      for (const target of routed.targets) {
        this.enqueue(target);
      }
      return;
    }

    const routed = resolveNextTargets(node.next, outcome.label, 'positive');
    if (!routed.ok) {
      this.pauseError({
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

  // Merges live tier progress into the node run's trace. Tiers are unique per kind, so
  // the trace entry for a tier is matched by kind.
  private reportTier(nodeId: string, run: NodeRun, tierRun: TierRun): void {
    const byKind = this.tierRuns.get(nodeId) ?? new Map<string, TierRun>();
    const existing = byKind.get(tierRun.kind);
    if (existing) {
      Object.assign(existing, tierRun);
    } else {
      byKind.set(tierRun.kind, tierRun);
      run.tiers.push(tierRun);
    }
    this.tierRuns.set(nodeId, byKind);
    this.touch();
  }

  private completeRun(run: NodeRun, outcome: RunResult, tiers: TierRun[]): void {
    run.outcome = outcome.outcome;
    run.label = outcome.label;
    run.error = outcome.error;
    run.output = outcome.output;
    run.usage = outcome.usage;
    run.tiers = tiers;
    run.status = 'ended';
    run.finishedAt = this.now().toISOString();
    if (outcome.output !== undefined) {
      this.outputs.set(run.nodeId, outcome.output);
    }
    this.touch();
  }

  private pauseError(error: FlowError): void {
    if (this.status !== 'running') {
      return;
    }
    this.status = 'paused';
    this.result = { outcome: { status: 'failed' }, error };
    this.touch();
    this.checkDone();
  }

  cancel(): void {
    if (this.completed || this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.suspended = false;
    this.queue.length = 0;
    this.queued.clear();
    this.status = 'ended';
    this.result = { outcome: { status: 'cancelled' } };
    this.touch();
    this.completed = true;
    this.onComplete?.();
  }

  pause(): void {
    if (this.status !== 'running' || this.suspended || this.cancelled) {
      return;
    }
    this.suspended = true;
    this.touch();
  }

  resume(): void {
    if (!this.suspended || this.cancelled) {
      return;
    }
    this.suspended = false;
    this.pump();
    this.checkDone();
  }

  // Re-executes a paused step from scratch. The previous step record is reset in place so
  // the trace does not grow a duplicate entry for the same attempt.
  retryStep(nodeId: string): void {
    this.assertOperable(nodeId);
    const index = this.lastStepIndex(nodeId);
    if (index !== -1) {
      const step = this.steps[index];
      step.status = 'running';
      step.tiers = [];
      step.startedAt = this.now().toISOString();
      delete step.outcome;
      delete step.label;
      delete step.error;
      delete step.output;
      delete step.usage;
      delete step.finishedAt;
      this.retryRun = { nodeId, run: step };
    }
    this.outputs.delete(nodeId);
    this.tierRuns.delete(nodeId);
    this.reopen();
    this.enqueue(nodeId);
  }

  // Marks the paused step as skipped and continues along its positive route, so the run
  // can move past a blocking step without re-executing it.
  skipStep(nodeId: string): void {
    this.assertOperable(nodeId);
    const node = this.nodes.get(nodeId)!;
    this.markSkipped(nodeId);
    this.reopen();

    const label = firstPositiveLabel(node);
    const routed = resolveNextTargets(node.next, label, 'positive');
    if (!routed.ok) {
      this.pauseError({
        code: 'flow.route.missing',
        message: `cannot skip "${nodeId}": no positive route is available`,
      });
      return;
    }
    if (routed.targets.length === 0) {
      this.finalize();
      return;
    }
    for (const target of routed.targets) {
      this.enqueue(target);
    }
  }

  // Abandons the paused position and starts executing the chosen step. History for steps
  // that already ran is preserved; the jump appends a fresh attempt.
  jumpToStep(nodeId: string): void {
    this.assertOperable(nodeId);
    this.reopen();
    this.enqueue(nodeId);
  }

  private assertOperable(nodeId: string): void {
    if (this.cancelled) {
      throw new OperatorActionError('run was cancelled and cannot be operated on');
    }
    if (this.status !== 'paused') {
      throw new OperatorActionError('run is not paused');
    }
    if (this.active > 0) {
      throw new OperatorActionError('run still has steps in flight; try again once they settle');
    }
    if (!this.nodes.has(nodeId)) {
      throw new OperatorActionError(`node "${nodeId}" does not exist in this flow`);
    }
  }

  private reopen(): void {
    this.queue.length = 0;
    this.queued.clear();
    this.status = 'running';
    this.result = undefined;
    this.suspended = false;
    this.cancelled = false;
    this.completed = false;
    this.touch();
  }

  private markSkipped(nodeId: string): void {
    const index = this.lastStepIndex(nodeId);
    if (index === -1) {
      return;
    }
    const step = this.steps[index];
    step.status = 'ended';
    step.outcome = { status: 'cancelled' };
    step.label = 'skipped';
    step.finishedAt = this.now().toISOString();
    this.outputs.delete(nodeId);
  }

  private lastStepIndex(nodeId: string): number {
    for (let index = this.steps.length - 1; index >= 0; index -= 1) {
      if (this.steps[index].nodeId === nodeId) {
        return index;
      }
    }
    return -1;
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

function firstPositiveLabel(node: FlowNode): string | undefined {
  const next = node.next;
  if (next === undefined || typeof next === 'string' || Array.isArray(next)) {
    return undefined;
  }
  const errorCodes = new Set((node.errors ?? []).map((error) => error.code));
  return Object.keys(next).find((label) => !errorCodes.has(label));
}
