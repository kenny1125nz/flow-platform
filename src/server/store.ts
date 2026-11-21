import type { FlowDefinition, FlowInstance, PlanDefinition } from '../model.js';
import type { PlanRunner } from '../plan-runner.js';

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

export type RegisteredRun =
  | { kind: 'flow'; instance: FlowInstance }
  | { kind: 'plan'; instance: PlanRunner };

export class RunRegistry {
  private readonly runs = new Map<string, RegisteredRun>();

  addFlow(instance: FlowInstance): void {
    this.runs.set(instance.id, { kind: 'flow', instance });
  }

  addPlan(instance: PlanRunner): void {
    this.runs.set(instance.id, { kind: 'plan', instance });
  }

  get(id: string): RegisteredRun | undefined {
    return this.runs.get(id);
  }

  list(): RegisteredRun[] {
    return [...this.runs.values()];
  }
}
