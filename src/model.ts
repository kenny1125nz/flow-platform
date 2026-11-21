export type StepType = 'human' | 'agent' | 'script';
export type OutcomeStatus = 'succeeded' | 'failed' | 'cancelled';

export type Goal = {
  id: string;
  description?: string;
};

export type Outcome = {
  status: OutcomeStatus;
  metrics?: Record<string, unknown>;
};

export type FlowError = {
  code: string;
  message?: string;
  hint?: string;
};

export type Next = string | string[] | Record<string, string | string[]>;

export type BaseNode = {
  id: string;
  type: StepType;
  errors?: FlowError[];
  next?: Next;
};

export type HumanNode = BaseNode & {
  type: 'human';
  assignee?: string;
  prompt?: string;
};

export type AgentNode = BaseNode & {
  type: 'agent';
  instruction: string;
};

export type ScriptNode = BaseNode & {
  type: 'script';
  run: string;
  args?: Record<string, unknown>;
};

export type FlowNode = HumanNode | AgentNode | ScriptNode;

export type Stage = {
  id: string;
  name?: string;
  nodes: FlowNode[];
  substages?: Stage[];
};

export type FlowDefinition = {
  id: string;
  version: string;
  stages: Stage[];
};

export type PlanNode = {
  id: string;
  goal: Goal;
  flow: { id: string; version: string };
  errors?: FlowError[];
  next?: Next;
};

export type PlanDefinition = {
  id: string;
  version: string;
  nodes: PlanNode[];
};

export type UnitStatus = 'running' | 'paused' | 'ended';

export type NodeRun = {
  nodeId: string;
  type: StepType;
  status: UnitStatus;
  outcome?: Outcome;
  label?: string;
  error?: FlowError;
  startedAt?: string;
  finishedAt?: string;
};

export type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
};

export interface FlowInstance {
  id: string;
  flow: { id: string; version: string };
  goal: Goal;
  status: UnitStatus;
  result?: RunResult;
  steps: NodeRun[];
  createdAt: string;
  updatedAt: string;
  execute(): Promise<RunResult>;
}

export type FlowRun = {
  nodeId: string;
  flowInstanceId: string;
};

export interface PlanInstance {
  id: string;
  plan: { id: string; version: string };
  status: UnitStatus;
  result?: RunResult;
  steps: FlowRun[];
  createdAt: string;
  updatedAt: string;
  execute(): Promise<RunResult>;
}
