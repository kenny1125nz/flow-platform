import type { FlowInstance } from '../model.js';
import type { FlowRunDetail, PlanRunDetail, PlanStepDetail, RunSummary } from '../api-types.js';
import type { PlanRunView } from './store.js';

export function flowRunSummary(run: FlowInstance): RunSummary {
  return {
    id: run.id,
    kind: 'flow',
    definition: { id: run.flow.id, version: run.flow.version },
    status: run.status,
    suspended: run.suspended,
    goal: run.goal,
    context: run.context,
    ...(run.result === undefined ? {} : { result: run.result }),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function planRunSummary(run: PlanRunView): RunSummary {
  return {
    id: run.id,
    kind: 'plan',
    definition: { id: run.plan.id, version: run.plan.version },
    status: run.status,
    suspended: run.suspended,
    context: run.context,
    ...(run.result === undefined ? {} : { result: run.result }),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export function flowRunDetail(run: FlowInstance): FlowRunDetail {
  return {
    ...flowRunSummary(run),
    kind: 'flow',
    goal: run.goal,
    steps: run.steps,
  };
}

export function planRunDetail(run: PlanRunView): PlanRunDetail {
  const steps: PlanStepDetail[] = run.definition.nodes.map((node) => {
    const flow = run.getFlowInstance(node.id);
    const flowRun = run.steps.find((step) => step.nodeId === node.id);

    return {
      nodeId: node.id,
      goal: node.goal,
      flow: node.flow,
      ...(node.next === undefined ? {} : { next: node.next }),
      ...(flowRun === undefined ? {} : { flowInstanceId: flowRun.flowInstanceId }),
      ...(flow === undefined ? {} : { flowStatus: flow.status, steps: flow.steps }),
      ...(flow?.result === undefined ? {} : { flowResult: flow.result }),
    };
  });

  return {
    ...planRunSummary(run),
    kind: 'plan',
    steps,
  };
}
