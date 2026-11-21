# Tech: Data Model

The data model has two families:

- **Definitions** — what should run. Plans and flows, authored as JSON and validated against
  a schema. Immutable by version.
- **Instances** — what is running and what happened. A plan instance, flow instances, and the
  node runs (steps) they carry.

TypeScript is the source of truth for both. JSON is the wire/storage form; a JSON Schema is
derived from the types (e.g. via TypeBox or Zod) and used to validate definitions.

## Conventions

- IDs are strings; timestamps are ISO 8601 strings.
- Definitions and instances are separate: an instance always references the exact definition
  version it started with.
- Union types are discriminated — `type` for nodes, `code` for errors — so invalid shapes are
  unrepresentable.
- Node runs are **part of** an instance, one per executed node, and are updated as that node
  progresses.

---

## Definitions

### Nodes

A flow is a graph. Each **node** is a step of one of three types. Nodes carry no
`dependsOn`; all relations are expressed by each node's `next` map.

```ts
type StepType = 'human' | 'agent' | 'script';
type OutcomeStatus = 'succeeded' | 'failed' | 'cancelled';

// The material objective a flow is applied to.
type Goal = {
  id: string;
  description?: string;
};

// The final result of a node or run, plus any metrics it reports.
type Outcome = {
  status: OutcomeStatus;
  metrics?: Record<string, unknown>;
};

// The platform's domain error. `code` is the stable routing key; `hint` is guidance on how
// to handle it and may be passed to an AI agent as instructions.
type FlowError = {
  code: string;
  message?: string;
  hint?: string;
};

// A bare string is a single positive outcome; a bare array is one positive outcome that
// fans out to several nodes in parallel. A map names each outcome label (and error code)
// to a target node id, or an array of ids for a parallel fan-out.
type Next = string | string[] | Record<string, string | string[]>;

type BaseNode = {
  id: string;
  type: StepType;
  // Errors this node may report. Each error code should be a label in `next`.
  errors?: FlowError[];
  // Labels are the node's possible positive outcomes, plus its error codes.
  next?: Next;
};

type HumanNode = BaseNode & {
  type: 'human';
  assignee?: string;
  prompt?: string;
};

type AgentNode = BaseNode & {
  type: 'agent';
  instruction: string; // one-shot instruction for the agent
};

type ScriptNode = BaseNode & {
  type: 'script';
  run: string; // job, container, or command
  args?: Record<string, unknown>;
};

type FlowNode = HumanNode | AgentNode | ScriptNode;
```

### Flow definition

A flow is a set of stages, each grouping nodes; each node points to its successors through
its `next` map.

```ts
type Stage = {
  id: string;
  name?: string;
  nodes: FlowNode[];
  substages?: Stage[];
};

type FlowDefinition = {
  id: string;
  version: string;
  stages: Stage[];
};
```

The same `Next` map is reused by plans, so both levels express relations identically.

Stages and substages are **logical grouping** — for organization and presentation. They do
not impose order. Relations live in each node's `next` map:

- A bare-string `next` is shorthand for a node with a **single positive outcome**: it points
  straight to the next node.
- A bare-array `next` is shorthand for a single positive outcome that fans out to all of its
  targets in **parallel**.
- With a map, a positive outcome carries a `label`; a failure carries a `FlowError` whose `code`
  is used as the label. A label may point to one node, or to an array of nodes for a
  **parallel fan-out**.
- Different labels name different **positive outcomes** — the node picks exactly one.
- An entry node has no incoming forward edge; rework/back edges do not disqualify an entry
  node.
- A node with no `next` entry ends its branch.
- Edges may route back to an earlier node for rework; a node may execute more than once.

Node ids are unique across the whole flow, so targets reference nodes by id regardless of
which stage or substage contains them.

With a map, a node reports a positive outcome `label` or a `FlowError`, and the label selects the
next target. With a bare string, any positive outcome proceeds to that node; with a bare
array, to all of them in parallel. Nodes fail fast — there are no retries. A label with no
matching entry (or an error the node did not declare) is unexpected, and the flow pauses.

### Plan definition

A plan is also a graph. Each node specifies a **material goal** and the flow that should
achieve it. The plan instance turns each node into a flow instance at runtime. The same `Next`
map models relations, so parallel branches and error routing work exactly as they do in a
flow.

```ts
type PlanNode = {
  id: string;
  goal: Goal;                              // the objective to achieve
  flow: { id: string; version: string };   // the flow that should achieve it
  errors?: FlowError[];                    // errors the flow may surface to the plan
  next?: Next;
};

type PlanDefinition = {
  id: string;
  version: string;
  nodes: PlanNode[];
};
```

- `next` targets are plan node ids.
- A bare-string `next` is a single positive outcome pointing straight to the next node.
- A bare-array `next` is a single positive outcome that runs all of its targets in parallel.
- With a map, a positive outcome carries a `label`; a failure carries a `FlowError` whose `code`
  is used as the label.
- A label may point to one node, or to an array of nodes for a parallel fan-out.
- Different labels name different positive outcomes.
- An entry node has no incoming forward edge; rework/back edges do not disqualify an entry
  node.
- A node with no `next` entry ends its branch.
- Edges may route back to an earlier node for rework; a node may execute more than once.

Like flows, plan nodes carry no `dependsOn`; all relations live in `next`.

---

## Instances

### Shared status

Plans, flows, and nodes share one lifecycle vocabulary:

```ts
type UnitStatus =
  | 'running'  // executing; a human node stays running until the human responds
  | 'paused'   // needs human intervention
  | 'ended';   // terminal
```

`UnitStatus` is the lifecycle state; `Outcome.status` is the terminal result. A unit has a
meaningful `outcome` once it has `ended`, and `paused` is where an unexpected error lands. An
`Outcome` carries that terminal status and an optional metrics record, and is shared by node
runs and ended runs. Metrics are an open `Record<string, unknown>`: their shape is not known
ahead of time, so each node reports what is meaningful for it.

### Flow instance and node runs

A flow instance is an **interface**: it holds a flow definition and a goal, and exposes an
`execute()` function that runs the nodes and returns the result the plan routes on.

`steps` is the ordered list of node runs. Callbacks are out of scope for now.

```ts
type NodeRun = {
  nodeId: string;
  type: StepType;
  status: UnitStatus;
  outcome?: Outcome;
  label?: string;           // chosen positive outcome option
  error?: FlowError;
  startedAt?: string;
  finishedAt?: string;
};

type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
};

interface FlowInstance {
  id: string;
  flow: { id: string; version: string }; // the definition being applied
  goal: Goal;                            // the target it is applied to
  status: UnitStatus;
  result?: RunResult;                    // captured return of execute()
  steps: NodeRun[];                      // ordered list of node runs
  createdAt: string;
  updatedAt: string;

  execute(): Promise<RunResult>;         // runs the flow; the plan consumes the return
}
```

The fields are the persisted state; `execute()` is runtime behavior and is not serialized.

### Plan instance and flow runs

A plan instance follows the same functional idea as a flow instance, but what it manages is
**flow instances** — one per plan node, each created for that node's material goal. It tracks
them by reference and does not embed them. Each `FlowRun` ties a plan node (`nodeId`,
definition side) to the flow instance started for its goal (`flowInstanceId`, runtime side).

```ts
type FlowRun = {
  nodeId: string;           // plan node id this run fulfills
  flowInstanceId: string;   // the flow instance started for it
};

interface PlanInstance {
  id: string;
  plan: { id: string; version: string };  // the definition being applied
  status: UnitStatus;
  result?: RunResult;                     // captured return of execute()
  steps: FlowRun[];                       // ordered list of flow runs
  createdAt: string;
  updatedAt: string;

  execute(): Promise<RunResult>;          // runs the plan
}
```

---

## Invariants

- A definition is immutable once versioned; an instance pins the version it started with.
- A flow instance is the invocation of a flow definition on a goal; its `execute()` returns
  the `RunResult` that the plan consumes.
- A plan instance is the invocation of a plan definition; its `execute()` returns a `RunResult`.
- All flow relations live in each node's `next` value; nodes and stages never carry
  `dependsOn` or impose order themselves.
- Stages and substages only group nodes; node ids are unique across the whole flow.
- A bare-string `next` is a single positive outcome and proceeds directly to that target.
- A bare-array `next` is a single positive outcome and proceeds to all targets in parallel.
- A map `next` names outcome labels (and error codes); every target it references must exist.
- Every `FlowError.code` a node declares should be a label in a map `next`; a node with declared
  errors cannot use the bare-string or bare-array form.
- A positive outcome label maps to one target, or to an array of targets for parallel fan-out;
  different labels are alternative outcomes.
- With a map, a node's outcome label must match an entry; a label with no matching entry is
  unexpected, and the run pauses.
- Each node execution appends a `NodeRun`; during that execution the run is updated in place.
  A rework edge can route back to an earlier node, which appends a new `NodeRun` for the new
  execution.
- Flow definitions do not need dedicated stop nodes; ending a flow is a platform concern.
  Rejection labels should route back to the node that must rework.
- `next` targets are flow node ids in a flow definition and plan node ids in a plan
  definition.
- Nodes fail fast; there are no retries.
- An error with no matching label (or a code the node did not declare) is unexpected, and the
  flow moves to `paused` for human intervention.
- For now, nodes run locally and return their result directly; no callback or correlation ID
  is involved.
