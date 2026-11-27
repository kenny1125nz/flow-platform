# Tech: Data Model

The data model has two families:

- **Definitions** — what should run. Plans, flows, and policies, authored as JSON and
  validated against a schema. Immutable by version.
- **Instances** — what is running and what happened. A plan instance, flow instances, and
  the node runs (steps) they carry — each node run recording the **run trace** of the
  executor(s) that participated.

TypeScript is the source of truth for both. JSON is the wire/storage form; a JSON Schema is
derived from the types (e.g. via TypeBox or Zod) and used to validate definitions.

## Conventions

- IDs are strings; timestamps are ISO 8601 strings.
- Definitions and instances are separate: an instance always references the exact definition
  version it started with.
- Union types are discriminated — `kind` for tiers, `code` for errors — so invalid shapes
  are unrepresentable.
- Node runs are **part of** an instance, one per executed node, and are updated as that node
  progresses.

---

## The one node model

There is no step "type". Every node is the same shape: a goal carried out by the
**executor that fits the task**. The executor is authored from the character of the work —
code for rules, an agent for tooled judgment, a human for context, taste, and accountability
— not chosen from runtime statistics. The representation is an ordered `tiers` array: the
first entry is the chosen executor, and any later entry is an explicit fallback.

| task shape | executor declaration |
|---|---|
| fully formalizable | `tiers: [script]` |
| rules resist, tools are fixed, result checkable | `tiers: [agent]` |
| expert input, judgment, taste, feedback, accountability | `tiers: [human]` |
| agent that may need a person when the check fails | `tiers: [agent, human]` — agent runs; human is the declared escalation |
| gate / verification step | a node **with criteria**, whose output is a verdict — nothing else |

A "gate" was never structurally different: any node can have multiple outcomes that route
through its `next` map. The special thing about verification nodes is **coverage** (how many
criteria have been formalized into deterministic checks) and that their `confidence` is the
deliverable itself, not just a quality tag.

### Tiers

```ts
type TierKind = 'script' | 'agent' | 'human';

type ScriptTier = { kind: 'script'; run: string; args?: Record<string, unknown> };
type AgentTier = { kind: 'agent'; instruction: string };
type HumanTier = { kind: 'human'; prompt?: string; assignee?: string };
type Tier = ScriptTier | AgentTier | HumanTier;
```

The first tier is the node's chosen executor; any later tier is an explicit fallback. The
order is authored, not sorted, and the tiers are not raced against each other. A node cannot
declare the same tier kind twice.

### Nodes

```ts
type Criterion = {
  id: string;
  statement: string;   // the verifiable condition
  verifyWith: string;  // how to produce the evidence: a command, a file, an observation
};

type FlowNode = {
  id: string;
  tiers: Tier[];                        // chosen executor, then any explicit fallback
  criteria?: Criterion[];               // verification nodes: acceptance criteria
  annotations?: Record<string, string>; // tags the policy matches on
  errors?: FlowError[];                 // errors this node may report
  next?: Next;                          // routing: multi-outcome, unchanged
};
```

- `annotations` are orthogonal tags (e.g. `risk: structural`, `domain: coding`). They carry
  no semantics of their own; the flow-level policy matches on them to decide how the
  executor's output is judged and when escalation is allowed.
- `criteria` drive the coverage metric: the share of criteria formalized into deterministic
  checks.

### Routing (`next`)

Unchanged from the original model. A bare string is a single positive outcome; a bare array
fans out in parallel; a map names outcome labels (and error codes) to targets. A "gate" is
simply a node whose map uses labels like `accepted` / `rejected` / `rework`.

---

## Policy: how an executor's output is judged

The **definition** declares the executor; the **policy** decides how that executor's output
is judged *today* — dynamically, without a new definition version. Policy tunes quality and
escalation; it never swaps the executor the task calls for.

```ts
type TierConfig = {
  bar: Partial<Record<TierKind, number>>;      // min confidence to accept an executor's output
  binding: Partial<Record<TierKind, boolean>>; // false = advisory: never finalizes the node
  requireHuman?: boolean;                      // keep a human even in an autonomous run
};

type DelegationConfig = {
  agreement: number;   // min agreement before an automated verdict is trusted
  minSamples: number;  // min samples before that trust applies
  sampling: number;    // probability of a low-rate human calibration check
};

type PolicyRule = {
  when: Record<string, string>;          // matched against node annotations
  config: Partial<TierConfig>;           // first matching rule wins
  delegation?: Partial<DelegationConfig>;
};

type FlowPolicy = {
  id: string;
  version: string;
  qualityBar: number;        // default acceptance bar
  config: TierConfig;
  delegation: DelegationConfig;
  rules: PolicyRule[];
};
```

- `bar` is the confidence threshold an executor must report to be accepted. An executor
  that reports no confidence is trusted as-is; the bar only applies to executors that report
  one.
- `binding: false` makes an executor advisory — it runs and is recorded, but its verdict
  never finalizes the node.
- `qualityBar` is the acceptable-result threshold; the engine optimizes cost/time **subject
  to** meeting it, never by moving the bar.
- `requireHuman` is the policy guard that keeps a human executor for a node or annotation
  class even when the run is autonomous.
- The `delegation` block is retained as the calibration settings for the low-rate human
  check; it does not select, drop, or swap an executor.

### Run autonomy

Autonomy is a **run-level input**, supplied when the run is initialized and persisted with
the instance — never inferred from statistics:

```ts
type AutonomyMode = 'supervised' | 'autonomous';

type WorkContext = {
  repo?: string;
  branch?: string;
  workspace?: string;
  issueId?: string;
  autonomy?: AutonomyMode;   // default: supervised
};
```

In an `autonomous` run the engine drops the human executor and lets the next cheaper
executor carry the work, unless policy sets `requireHuman` for the node. It also does not
gate on confidence: a verdict without an error is accepted so the flow keeps moving (errors
still escalate or route). A `supervised` run keeps the human anchor (subject to the
statistical delegation below). The same context is passed from a plan run to the flow
instances it starts.
- Policies live in a `PolicyStore`, keyed by flow `id@version`. The default policy applies
  to flows without one. (`GET/PUT /api/policies`)

---

## Statistics: evidence for calibration and re-authoring

Every completed node run feeds its run trace into a `StatsStore`. Stats are keyed by node
(`node:<flow>@<version>:<nodeId>`) **and** by annotation class (`class:k=v;...`), so evidence
transfers to nodes that have never run.

```ts
type KeyStat = {
  key: string;
  runs: number;
  escalations: number;     // executor runs below their bar
  coverage: { sum: number; count: number };
  agreement: Partial<Record<'agent-human' | 'script-human', { agreed: number; total: number }>>;
  lastUpdated: string;
};
```

- **Agreement** counts the cases where an automated verdict was accepted *and* a human
  calibration check still ran — and compares their verdicts (outcome + label). It is the
  check that keeps an automated verdict honest.
- **Escalations** count executor runs that fell below their bar.
- **Coverage** averages the criteria coverage reported by script executors.
- Stats persist to `flow-stats.json` next to the run store and are exposed at
  `GET /api/stats`.

Calibration: when a node's (or class's) agreement is at or above the configured threshold
for at least the minimum number of samples, an automated verdict is treated as trusted — but
a low-rate human check still runs at `delegation.sampling`, which keeps the statistics
honest. Without sampling, an automated verdict would never be checked again and trust would
silently drift. Statistics never switch a node's executor: moving work to a cheaper executor
is a deliberate **re-authoring**, versioned like any definition change.

---

## Instances

### Shared status

Plans, flows, and nodes share one lifecycle vocabulary:

```ts
type UnitStatus = 'running' | 'paused' | 'ended';
```

`UnitStatus` is the lifecycle state; `Outcome.status` is the terminal result. A unit has a
meaningful `outcome` once it has `ended`, and `paused` is where an unexpected error lands.

### Node runs and run traces

A node run records the **run trace**: one entry per participating executor, in execution
order. The trace is what makes execution measurable — calibration, agreement, coverage, and
cost are all computed from it.

```ts
type TierRun = {
  kind: TierKind;
  status: UnitStatus;
  outcome?: OutcomeStatus;
  label?: string;          // the executor's verdict label
  output?: unknown;
  confidence?: number;     // self-reported confidence (0..1)
  coverage?: number;       // verification nodes: share of criteria covered
  error?: FlowError;
  escalated?: boolean;     // true when the output fell below the executor's bar
  advisory?: boolean;      // true when the executor ran but was not binding
  sampled?: boolean;       // true when the run was only a calibration check
  stdout?: string;         // raw process stdout for script/agent executors
  stderr?: string;         // raw process stderr for script/agent executors
  startedAt?: string;
  finishedAt?: string;
};

type NodeRun = {
  nodeId: string;
  status: UnitStatus;
  outcome?: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;        // the accepted output (from the executor that met the bar)
  usage?: TokenUsage;
  tiers: TierRun[];        // the run trace
  startedAt?: string;
  finishedAt?: string;
};

type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;
  usage?: TokenUsage;
  stdout?: string;         // raw process stdout for script/agent executors
  stderr?: string;         // raw process stderr for script/agent executors
  confidence?: number;     // an executor may report its confidence in its output
  coverage?: number;       // a script executor may report its criteria coverage
};
```

Executor runs are reported **live**: while a human-executed node waits for a response,
the node run is `running` and its human run is `running`, so the presentation can show which
executor is currently carrying the work.

Script and agent executors capture raw **stdout** and **stderr** on their `TierRun`, so the
run detail can show exactly what the process printed without re-running it.

### Flow instance and plan instance

Unchanged structurally. A flow instance holds the definition, the goal, and its node runs; a
plan instance holds flow runs, one per plan node, tracked by reference.

---

## Invariants

- A definition is immutable once versioned; an instance pins the version it started with.
- Every node declares at least one executor; tier kinds are unique per node. The first tier
  is the chosen executor and any later tier is an explicit fallback; they are not raced.
- An executor's output is accepted when it meets its bar; if it cannot complete, the node
  follows its declared fallback, if any.
- A sampled human check that disagrees with an automated verdict **overrides** it — the
  check always wins disagreements.
- Calibration sampling keeps automated verdicts checked; statistics inform re-authoring but
  never select the executor for an individual run.
- All flow relations live in each node's `next` value; nodes and stages never carry
  `dependsOn` or impose order themselves.
- A bare-string `next` is a single positive outcome and proceeds directly to that target.
- A bare-array `next` is a single positive outcome and proceeds to all targets in parallel.
- A map `next` names outcome labels (and error codes); every target it references must exist.
- Every `FlowError.code` a node declares should be a label in a map `next`; a node with
  declared errors cannot use the bare-string or bare-array form.
- Each node execution appends a `NodeRun`; during that execution the run and its trace
  entries are updated in place. A rework edge can route back to an earlier node, which
  appends a new `NodeRun` for the new execution.
- Nodes fail fast; there are no retries — but an executor that cannot confidently answer is
  not a node failure, it is an escalation to the declared fallback.
- An error with no matching label (or a code the node did not declare) is unexpected, and the
  flow moves to `paused` for human intervention.
- For now, nodes run locally and return their result directly; no callback or correlation ID
  is involved.
