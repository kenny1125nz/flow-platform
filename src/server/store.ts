import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  FlowDefinition,
  FlowInstance,
  FlowRun,
  Goal,
  NodeRun,
  PlanDefinition,
  RunResult,
  UnitStatus,
  WorkContext,
} from '../model.js';

export function definitionKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export class DefinitionStore {
  private readonly flows = new Map<string, FlowDefinition>();
  private readonly plans = new Map<string, PlanDefinition>();

  putFlow(definition: FlowDefinition): void {
    this.flows.set(definitionKey(definition.id, definition.version), definition);
  }

  getFlow(id: string, version: string): FlowDefinition | undefined {
    return this.flows.get(definitionKey(id, version));
  }

  listFlows(): FlowDefinition[] {
    return [...this.flows.values()];
  }

  putPlan(definition: PlanDefinition): void {
    this.plans.set(definitionKey(definition.id, definition.version), definition);
  }

  getPlan(id: string, version: string): PlanDefinition | undefined {
    return this.plans.get(definitionKey(id, version));
  }

  listPlans(): PlanDefinition[] {
    return [...this.plans.values()];
  }
}

// The persisted, JSON-serializable representation of a flow instance. It mirrors every
// field of FlowInstance except the execute() method, which is not durable state.
export type FlowRunData = {
  id: string;
  flow: { id: string; version: string };
  goal: Goal;
  context: WorkContext;
  status: UnitStatus;
  result?: RunResult;
  steps: NodeRun[];
  createdAt: string;
  updatedAt: string;
};

// The persisted, JSON-serializable representation of a plan instance. The nested flow
// instances are persisted as their own FlowRunData files (identifiable by their own run
// id) and re-linked by flowInstanceId when the plan is reloaded.
export type PlanRunData = {
  id: string;
  plan: { id: string; version: string };
  context: WorkContext;
  status: UnitStatus;
  result?: RunResult;
  steps: FlowRun[];
  createdAt: string;
  updatedAt: string;
  // A snapshot of the plan definition is stored alongside the run so the plan detail can
  // be rendered after a restart even when the definition was only ever provided via POST
  // and is therefore not present in the (non-persisted) definition store.
  definition: PlanDefinition;
};

export type PersistedRun =
  | { kind: 'flow'; instance: FlowRunData }
  | { kind: 'plan'; instance: PlanRunData };

// The structural view of a plan run required to render its detail. PlanRunner satisfies
// this, as do the frozen plan instances produced when a run is reloaded from disk.
export type PlanRunView = {
  id: string;
  plan: { id: string; version: string };
  context: WorkContext;
  status: UnitStatus;
  suspended: boolean;
  result?: RunResult;
  steps: FlowRun[];
  createdAt: string;
  updatedAt: string;
  definition: PlanDefinition;
  getFlowInstance(nodeId: string): FlowInstance | undefined;
  cancel(): void;
  pause(): void;
  resume(): void;
};

export type RegisteredRun =
  | { kind: 'flow'; instance: FlowInstance }
  | { kind: 'plan'; instance: PlanRunView };

export class RunRegistry {
  private readonly runs = new Map<string, RegisteredRun>();

  addFlow(instance: FlowInstance): void {
    this.runs.set(instance.id, { kind: 'flow', instance });
  }

  addPlan(instance: PlanRunView): void {
    this.runs.set(instance.id, { kind: 'plan', instance });
  }

  get(id: string): RegisteredRun | undefined {
    return this.runs.get(id);
  }

  list(): RegisteredRun[] {
    return [...this.runs.values()];
  }
}

// A durable run store that writes each run to its own JSON file (named by run id) as it
// changes and reloads them on startup. File-based, mirroring how the coding flow
// definition is read from flows/coding/definition.json.
export class RunStore {
  constructor(private readonly dir: string) {}

  save(entry: RegisteredRun): void {
    mkdirSync(this.dir, { recursive: true });
    const data = serializeRun(entry);
    writeFileSync(this.fileFor(data.instance.id), JSON.stringify(data));
  }

  load(registry: RunRegistry): void {
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch {
      return;
    }

    const flows = new Map<string, FlowInstance>();
    const plans: PlanRunData[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }
      let data: PersistedRun;
      try {
        data = JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as PersistedRun;
      } catch {
        continue;
      }
      // Skip files that are not run records (e.g. the stats store's flow-stats.json).
      if (data.kind !== 'flow' && data.kind !== 'plan') {
        continue;
      }
      if (data.kind === 'flow') {
        const flow = freezeFlow(data.instance);
        registry.addFlow(flow);
        flows.set(flow.id, flow);
      } else {
        plans.push(data.instance);
      }
    }

    for (const planData of plans) {
      registry.addPlan(freezePlan(planData, (flowInstanceId) => flows.get(flowInstanceId)));
    }
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}

function serializeRun(entry: RegisteredRun): PersistedRun {
  if (entry.kind === 'flow') {
    return { kind: 'flow', instance: toFlowData(entry.instance) };
  }
  return { kind: 'plan', instance: toPlanData(entry.instance) };
}

function toFlowData(instance: FlowInstance): FlowRunData {
  return {
    id: instance.id,
    flow: instance.flow,
    goal: instance.goal,
    context: instance.context,
    status: instance.status,
    ...(instance.result === undefined ? {} : { result: instance.result }),
    steps: instance.steps,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  };
}

function toPlanData(instance: PlanRunView): PlanRunData {
  return {
    id: instance.id,
    plan: instance.plan,
    context: instance.context,
    status: instance.status,
    ...(instance.result === undefined ? {} : { result: instance.result }),
    steps: instance.steps,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    definition: instance.definition,
  };
}

function freezeFlow(data: FlowRunData): FlowInstance {
  return {
    ...data,
    steps: data.steps.map((step) => ({ ...step, tiers: step.tiers ?? [] })),
    suspended: false,
    execute(): Promise<RunResult> {
      throw new Error(`run ${data.id} was reloaded and cannot be executed`);
    },
    cancel(): void {},
    pause(): void {},
    resume(): void {},
  };
}

function freezePlan(
  data: PlanRunData,
  resolveFlow: (flowInstanceId: string) => FlowInstance | undefined,
): PlanRunView {
  return {
    id: data.id,
    plan: data.plan,
    context: data.context,
    status: data.status,
    suspended: false,
    ...(data.result === undefined ? {} : { result: data.result }),
    steps: data.steps,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    definition: data.definition,
    getFlowInstance(nodeId: string): FlowInstance | undefined {
      const step = data.steps.find((candidate) => candidate.nodeId === nodeId);
      return step ? resolveFlow(step.flowInstanceId) : undefined;
    },
    cancel(): void {},
    pause(): void {},
    resume(): void {},
  };
}
