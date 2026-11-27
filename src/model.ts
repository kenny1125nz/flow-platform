export type TierKind = 'script' | 'agent' | 'human';
export type OutcomeStatus = 'succeeded' | 'failed' | 'cancelled';

// The canonical execution order: the cheapest, most deterministic tier runs first and
// the cascade escalates upwards when a tier cannot meet the acceptance bar.
export const TIER_ORDER: readonly TierKind[] = ['script', 'agent', 'human'];

export type Goal = {
  id: string;
  description?: string;
};

// How human-checkable steps are handled for a run. `supervised` (the default) keeps the
// human executor as the anchor; `autonomous` lets the engine drop human executors and let
// the next cheaper executor carry the work, except where a policy rule requires a human.
export type AutonomyMode = 'supervised' | 'autonomous';

// The environment a run executes in — where the work happens. Set at run start and
// carried to every tier (agent/script/human) so tiers know the target repo, branch,
// and workspace without re-deriving them.
export type WorkContext = {
  repo?: string;      // owner/repo or remote url
  branch?: string;    // working branch
  workspace?: string; // local checkout path
  issueId?: string;   // an existing issue the work is triggered by
  autonomy?: AutonomyMode; // run-level executor mode (default: supervised)
};

export type Outcome = {
  status: OutcomeStatus;
  metrics?: Record<string, unknown>;
};

// Token/cost usage reported by an agent tier.
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

// A criterion a verification node checks against. Each criterion can be formalized into
// a deterministic check; the share of criteria covered by the script tier is the node's
// coverage.
export type Criterion = {
  id: string;
  statement: string;   // the verifiable condition
  verifyWith: string;  // how to produce the evidence: a command, a file, an observation
};

// One executor tier of a node. A node's tiers form its joint-effort stack, executed in
// canonical order (script → agent → human) with escalation on insufficient confidence.
export type ScriptTier = {
  kind: 'script';
  run: string;
  args?: Record<string, unknown>;
};

export type AgentTier = {
  kind: 'agent';
  instruction: string;
};

export type HumanTier = {
  kind: 'human';
  prompt?: string;
  assignee?: string;
};

export type Tier = ScriptTier | AgentTier | HumanTier;

// Every node is the same shape: a goal carried out by the joint effort of script, agent,
// and human tiers. The old step "types" are just degenerate tier stacks:
//   script node = [script], agent node = [agent, human], human node = [script, agent, human].
export type FlowNode = {
  id: string;
  tiers: Tier[];
  // Acceptance criteria for verification-flavored nodes; drives the coverage metric.
  criteria?: Criterion[];
  // Tags the flow-level policy matches on to decide how the tiers cooperate.
  annotations?: Record<string, string>;
  // Errors this node may report. Each error code should be a label in `next`.
  errors?: FlowError[];
  // Labels are the node's possible positive outcomes, plus its error codes.
  next?: Next;
};

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

// One tier's contribution within a node run. The trace of tiers is what makes evolution
// measurable: calibration, agreement, coverage, and cost are all computed from it.
export type TierRun = {
  kind: TierKind;
  status: UnitStatus;
  outcome?: OutcomeStatus;   // the tier's terminal result
  label?: string;            // the tier's verdict label, when it picks one
  output?: unknown;          // what the tier produced
  confidence?: number;       // self-reported confidence in the output (0..1)
  coverage?: number;         // verification tiers: fraction of criteria covered
  error?: FlowError;
  escalated?: boolean;       // true when the tier's output fell below its bar
  advisory?: boolean;        // true when the tier ran but its verdict was not authoritative
  sampled?: boolean;         // true when the tier ran only to gather calibration data
  stdout?: string;           // raw process stdout for script/agent tiers
  stderr?: string;           // raw process stderr for script/agent tiers
  startedAt?: string;
  finishedAt?: string;
};

export type NodeRun = {
  nodeId: string;
  status: UnitStatus;
  outcome?: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;      // the accepted output of the node (from the tier that met the bar)
  usage?: TokenUsage;
  tiers: TierRun[];      // the joint-effort trace, in execution order
  startedAt?: string;
  finishedAt?: string;
};

export type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;
  usage?: TokenUsage;
  // Raw process output for script/agent tiers, captured so the run detail can show it.
  stdout?: string;
  stderr?: string;
  // A tier may report how confident it is in its output; the cascade compares it against
  // the tier's acceptance bar.
  confidence?: number;
  // A verification tier may report how much of the criteria its checks cover.
  coverage?: number;
};

export interface FlowInstance {
  id: string;
  flow: { id: string; version: string };
  goal: Goal;
  context: WorkContext;
  status: UnitStatus;
  suspended: boolean;
  result?: RunResult;
  steps: NodeRun[];
  createdAt: string;
  updatedAt: string;
  execute(): Promise<RunResult>;
  cancel(): void;
  pause(): void;
  resume(): void;
  // Operator recovery actions for a paused/blocked run. Optional because reloaded runs
  // are read-only and cannot be operated on.
  retryStep?(nodeId: string): void;
  skipStep?(nodeId: string): void;
  jumpToStep?(nodeId: string): void;
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
  suspended: boolean;
  result?: RunResult;
  steps: FlowRun[];
  createdAt: string;
  updatedAt: string;
  execute(): Promise<RunResult>;
  cancel(): void;
  pause(): void;
  resume(): void;
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
  feedback?: string; // free-form guidance when the verdict is a rejection/rework
};
