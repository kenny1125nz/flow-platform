import type {
  FlowError,
  Goal,
  Next,
  NodeRun,
  OutcomeStatus,
  RunResult,
  UnitStatus,
  WorkContext,
} from './model.js';

export type DefinitionRef = {
  id: string;
  version: string;
};

export type DefinitionSummary = {
  kind: 'flow' | 'plan';
  id: string;
  version: string;
  nodeCount: number;
};

export type RunSummary = {
  id: string;
  kind: 'flow' | 'plan';
  definition: DefinitionRef;
  status: UnitStatus;
  suspended?: boolean;
  goal?: Goal;
  context?: WorkContext;
  result?: RunResult;
  createdAt: string;
  updatedAt: string;
};

export type FlowRunDetail = RunSummary & {
  kind: 'flow';
  goal: Goal;
  steps: NodeRun[];
};

export type PlanStepDetail = {
  nodeId: string;
  goal: Goal;
  flow: DefinitionRef;
  next?: Next;
  flowInstanceId?: string;
  flowStatus?: UnitStatus;
  flowResult?: RunResult;
  steps?: NodeRun[];
};

export type PlanRunDetail = RunSummary & {
  kind: 'plan';
  steps: PlanStepDetail[];
};

export type RunDetail = FlowRunDetail | PlanRunDetail;

export type CreateFlowRunBody = {
  goal: Goal;
  context?: WorkContext;
};

export type CreatePlanRunBody = {
  context?: WorkContext;
};

export type HumanRespondBody = {
  outcome: OutcomeStatus;
  label?: string;
  error?: FlowError;
  metrics?: Record<string, unknown>;
  confidence?: number;
  data?: unknown;
};

export type FlowOperatorAction = 'retry' | 'skip' | 'jump';

export type FlowOperatorBody = {
  action: FlowOperatorAction;
  nodeId: string;
};

export type PolicySummary = {
  id: string;
  version: string;
};

export type ErrorBody = {
  error: string;
  issues?: { path: string; message: string }[];
};

export type RunEvent = {
  runId: string;
  kind: 'flow' | 'plan';
  status: UnitStatus;
  updatedAt: string;
};

export type StreamEvent = { type: 'run'; run: RunEvent };
