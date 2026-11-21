import { randomUUID } from 'node:crypto';
import type {
  FlowDefinition,
  FlowError,
  FlowInstance,
  FlowRun,
  PlanDefinition,
  PlanInstance,
  PlanNode,
  RunResult,
  UnitStatus,
} from './model.js';
import {
  entryPlanNodeIds,
  resolveNextTargets,
  validatePlanDefinition,
} from './graph.js';
import { FlowRunner } from './flow-runner.js';
import type { NodeExecutor } from './runtime.js';
import { succeeded } from './result.js';

export type FlowResolver = (ref: { id: string; version: string }) => FlowDefinition;

export function createFlowResolver(definitions: FlowDefinition[]): FlowResolver {
  const byKey = new Map(definitions.map((definition) => [flowKey(definition.id, definition.version), definition]));
  return (ref) => {
    const definition = byKey.get(flowKey(ref.id, ref.version));
    if (!definition) {
      throw new Error(`flow definition "${ref.id}@${ref.version}" was not found`);
    }
    return definition;
  };
}

export type PlanRunnerOptions = {
  id?: string;
  definition: PlanDefinition;
  resolveFlow: FlowResolver;
  executor: NodeExecutor;
  now?: () => Date;
  onChange?: (instance: PlanInstance) => void;
  onFlowInstance?: (nodeId: string, instance: FlowInstance) => void;
};

export class PlanRunner implements PlanInstance {
  readonly id: string;
  readonly plan: { id: string; version: string };
  readonly steps: FlowRun[] = [];
  readonly createdAt: string;

  status: UnitStatus = 'running';
  result?: RunResult;
  updatedAt: string;

  readonly definition: PlanDefinition;
  private readonly nodes: Map<string, PlanNode>;
  private readonly resolveFlow: FlowResolver;
  private readonly executor: NodeExecutor;
  private readonly now: () => Date;
  private readonly onChange?: (instance: PlanInstance) => void;
  private readonly onFlowInstance?: (nodeId: string, instance: FlowInstance) => void;
  private readonly flowInstances = new Map<string, FlowRunner>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private readonly inFlight = new Map<string, symbol>();
  private readonly terminalResults: RunResult[] = [];
  private active = 0;
  private pumping = false;
  private completed = false;
  private onComplete?: () => void;
  private execution?: Promise<RunResult>;

  constructor(options: PlanRunnerOptions) {
    validatePlanDefinition(options.definition);
    this.id = options.id ?? randomUUID();
    this.plan = { id: options.definition.id, version: options.definition.version };
    this.definition = options.definition;
    this.nodes = new Map(options.definition.nodes.map((node) => [node.id, node]));
    this.resolveFlow = options.resolveFlow;
    this.executor = options.executor;
    this.now = options.now ?? (() => new Date());
    this.onChange = options.onChange;
    this.onFlowInstance = options.onFlowInstance;
    this.createdAt = this.now().toISOString();
    this.updatedAt = this.createdAt;
  }

  getFlowInstance(nodeId: string): FlowInstance | undefined {
    return this.flowInstances.get(nodeId);
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

    for (const nodeId of entryPlanNodeIds(this.definition)) {
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
      this.pause({ code: 'plan.node.missing', message: `plan node "${nodeId}" does not exist` });
      return;
    }

    let flowInstance: FlowRunner;
    let outcome: RunResult;
    try {
      const definition = this.resolveFlow(node.flow);
      flowInstance = new FlowRunner({
        definition,
        goal: node.goal,
        executor: this.executor,
        now: this.now,
        onChange: (instance) => this.onFlowInstance?.(node.id, instance),
      });
      this.flowInstances.set(node.id, flowInstance);
      this.steps.push({ nodeId: node.id, flowInstanceId: flowInstance.id });
      this.onFlowInstance?.(node.id, flowInstance);
      this.touch();
      outcome = await flowInstance.execute();
    } catch (error) {
      this.inFlight.delete(nodeId);
      const flowError: FlowError = {
        code: 'flow.instance.error',
        message: error instanceof Error ? error.message : String(error),
      };
      this.pause(flowError);
      return;
    }

    this.inFlight.delete(nodeId);

    if (this.status !== 'running') {
      return;
    }

    if (outcome.outcome.status !== 'succeeded' || outcome.error) {
      const error =
        outcome.error ??
        ({
          code: `flow.${outcome.outcome.status}`,
          message: `flow for plan node "${nodeId}" ended with ${outcome.outcome.status}`,
        } satisfies FlowError);
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
        code: 'plan.route.missing',
        message: `no next entry for label "${outcome.label ?? ''}" on plan node "${nodeId}"`,
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

function flowKey(id: string, version: string): string {
  return `${id}@${version}`;
}
