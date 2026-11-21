export type StepType = 'human' | 'agent' | 'script';
export type OutcomeStatus = 'succeeded' | 'failed' | 'cancelled';

export type Goal = {
  id: string;
  description?: string;
};

// The environment a run executes in — where the work happens. Set at run start and
// carried to every step (agent/script/human) so steps know the target repo, branch,
// and workspace without re-deriving them.
export type WorkContext = {
  repo?: string;      // owner/repo or remote url
  branch?: string;    // working branch
  workspace?: string; // local checkout path
  issueId?: string;   // an existing issue the work is triggered by
};

export type Outcome = {
  status: OutcomeStatus;
  metrics?: Record<string, unknown>;
};

// Token/cost usage reported by an agent step.
export type TokenUsage = {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
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
  output?: unknown;
  usage?: TokenUsage;
  startedAt?: string;
  finishedAt?: string;
};

export type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;
  usage?: TokenUsage;
};

export interface FlowInstance {
  id: string;
  flow: { id: string; version: string };
  goal: Goal;
  context: WorkContext;
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
  context: WorkContext;
  status: UnitStatus;
  result?: RunResult;
  steps: FlowRun[];
  createdAt: string;
  updatedAt: string;
  execute(): Promise<RunResult>;
}

// --- Task spec (Frame stage artifact) ---
//
// The Frame stage pins the contract a coding agent works against: what is in scope,
// what must hold for the work to be accepted, and how completion is measured. It
// deliberately does not prescribe the implementation approach — internal design
// choices are left to the implementer. Every field is data, not prose, so a human
// can check it criterion-by-criterion with evidence rather than rubber-stamp it.

export type AcceptanceCriterion = {
  id: string;
  statement: string;   // the verifiable condition
  verifyWith: string;  // how to produce the evidence: a command, a file, an observation
};

export type TaskSpec = {
  goal: {
    statement: string;   // a single unambiguous statement of what is true when done
    nonGoals: string[];  // explicit out-of-scope items
  };
  constraints: string[]; // non-negotiable decisions: public API shape, hard requirements
  scope: {
    files: string[];         // files the change may touch
    mustNotChange: string[]; // hard fence: files that must remain untouched
  };
  acceptanceCriteria: AcceptanceCriterion[];
  evaluation: {
    commands: string[]; // automated build/test commands that determine "done"
    manualChecks: string[]; // human observations that cannot be automated
  };
};

export type CriterionVerdict = {
  criterionId: string;
  satisfied: boolean;
  evidence: string; // the concrete evidence for this criterion
};

export type ConfirmVerdict = {
  criteria: CriterionVerdict[]; // one entry per acceptance criterion
};
