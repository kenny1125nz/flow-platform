# Tech: Data Model

The data model has two families:

- **Definitions** — what should run. Plans, flows, and policies, authored as JSON and
  validated against a schema. Immutable by version.
- **Instances** — what is running and what happened. A plan instance, flow instances, and
  the node runs (steps) they carry — each node run recording the **tier trace** of the
  script, agent, and human tiers that participated.

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

There is no step "type". Every node is the same shape: a goal carried out by the **joint
effort** of three executor tiers — script, agent, and human — ordered cheapest-first
(`script → agent → human`). The old step types are just degenerate tier stacks:

| what it used to be | what it is now |
|---|---|
| script step | `tiers: [script]` |
| agent step | `tiers: [agent]` (human escalates only on low confidence) |
| human step | `tiers: [script?, agent, human]` — earlier tiers prepare/attempt, the human anchors |
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

Tiers are executed in canonical order (script → agent → human) regardless of authoring
order; the cascade sorts them. A node cannot declare the same tier kind twice.

### Nodes

```ts
type Criterion = {
  id: string;
  statement: string;   // the verifiable condition
  verifyWith: string;  // how to produce the evidence: a command, a file, an observation
};

type FlowNode = {
  id: string;
  tiers: Tier[];                        // the joint-effort stack
  criteria?: Criterion[];               // verification nodes: acceptance criteria
  annotations?: Record<string, string>; // tags the policy matches on
  errors?: FlowError[];                 // errors this node may report
  next?: Next;                          // routing: multi-outcome, unchanged
};
```

- `annotations` are orthogonal tags (e.g. `risk: structural`, `domain: coding`). They carry
  no semantics of their own; the flow-level policy matches on them to decide how the tiers
  cooperate.
- `criteria` drive the coverage metric: the share of criteria the script tier has formalized
  into deterministic checks.

### Routing (`next`)

Unchanged from the original model. A bare string is a single positive outcome; a bare array
fans out in parallel; a map names outcome labels (and error codes) to targets. A "gate" is
simply a node whose map uses labels like `accepted` / `rejected` / `rework`.

---

## Policy: how the tiers cooperate

The **definition** declares the tier stack; the **policy** decides how the tiers cooperate
*today* — dynamically, without a new definition version.

```ts
type TierConfig = {
  bar: Partial<Record<TierKind, number>>;      // min confidence to accept a tier's output
  binding: Partial<Record<TierKind, boolean>>; // false = advisory: never finalizes the node
};

type DelegationConfig = {
  agreement: number;   // min agreement with the human anchor before delegating
  minSamples: number;  // min samples before delegation may apply
  sampling: number;    // probability of a human calibration run after delegation
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

- `bar` is the confidence threshold a tier must report to be accepted. A tier that reports
  no confidence is trusted as-is; the bar only applies to tiers that report one.
- `binding: false` makes a tier advisory — it runs, is recorded, but its verdict never
  finalizes the node.
- `qualityBar` is the acceptable-result threshold; the engine optimizes cost/time **subject
  to** meeting it, never by moving the bar.
- Policies live in a `PolicyStore`, keyed by flow `id@version`. The default policy applies
  to flows without one. (`GET/PUT /api/policies`)

---

## Statistics: the evidence for evolution

Every completed node run feeds its tier trace into a `StatsStore`. Stats are keyed by node
(`node:<flow>@<version>:<nodeId>`) **and** by annotation class (`class:k=v;...`), so evidence
transfers to nodes that have never run.

```ts
type KeyStat = {
  key: string;
  runs: number;
  escalations: number;     // tier runs below their bar
  coverage: { sum: number; count: number };
  agreement: Partial<Record<'agent-human' | 'script-human', { agreed: number; total: number }>>;
  lastUpdated: string;
};
```

- **Agreement** counts the cases where the tier below human met its bar *and* the human
  anchor still ran — and compares their verdicts (outcome + label). It is the ground truth
  that delegation is measured against.
- **Escalations** count tier runs that fell below their bar.
- **Coverage** averages the criteria coverage reported by script tiers.
- Stats persist to `flow-stats.json` next to the run store and are exposed at
  `GET /api/stats`.

Delegation: when a node's (or class's) agreement with the human anchor is at or above
`delegation.agreement` for at least `delegation.minSamples` samples, the engine **drops the
human tier** — except for random calibration samples drawn at `delegation.sampling`, which
keep the statistics honest. Without sampling, delegated verdicts would never be checked
again and confidence would silently drift.

---

## Instances

### Shared status

Plans, flows, and nodes share one lifecycle vocabulary:

```ts
type UnitStatus = 'running' | 'paused' | 'ended';
```

`UnitStatus` is the lifecycle state; `Outcome.status` is the terminal result. A unit has a
meaningful `outcome` once it has `ended`, and `paused` is where an unexpected error lands.

### Node runs and tier runs

A node run records the **tier trace**: one entry per participating tier, in execution order.
The trace is what makes evolution measurable — calibration, agreement, coverage, and cost
are all computed from it.

```ts
type TierRun = {
  kind: TierKind;
  status: UnitStatus;
  outcome?: OutcomeStatus;
  label?: string;          // the tier's verdict label
  output?: unknown;
  confidence?: number;     // self-reported confidence (0..1)
  coverage?: number;       // verification tiers: share of criteria covered
  error?: FlowError;
  escalated?: boolean;     // true when the output fell below the tier's bar
  advisory?: boolean;      // true when the tier ran but was not binding
  sampled?: boolean;       // true when the tier ran only for calibration
  startedAt?: string;
  finishedAt?: string;
};

type NodeRun = {
  nodeId: string;
  status: UnitStatus;
  outcome?: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;        // the accepted output (from the tier that met the bar)
  usage?: TokenUsage;
  tiers: TierRun[];        // the joint-effort trace
  startedAt?: string;
  finishedAt?: string;
};

type RunResult = {
  outcome: Outcome;
  label?: string;
  error?: FlowError;
  output?: unknown;
  usage?: TokenUsage;
  confidence?: number;     // a tier may report its confidence in its output
  coverage?: number;       // a script tier may report its criteria coverage
};
```

Tier runs are reported **live**: while a human tier waits for a response, the node run is
`running` and its human tier run is `running`, so the presentation can show which tier is
currently carrying the work.

### Flow instance and plan instance

Unchanged structurally. A flow instance holds the definition, the goal, and its node runs; a
plan instance holds flow runs, one per plan node, tracked by reference.

---

## Invariants

- A definition is immutable once versioned; an instance pins the version it started with.
- Every node declares at least one tier; tier kinds are unique per node and execute in
  canonical order: script → agent → human.
- The cascade accepts the **first** tier whose output meets its bar; a tier that fails its
  bar escalates to the next tier. The human tier is the anchor and the last resort.
- A sampled human tier that disagrees with an accepted lower-tier verdict **overrides** it —
  the anchor always wins disagreements.
- Delegation only drops the human tier when the measured agreement with it is at or above
  the policy threshold for enough samples, and calibration sampling keeps that measurement
  alive.
- All flow relations live in each node's `next` value; nodes and stages never carry
  `dependsOn` or impose order themselves.
- A bare-string `next` is a single positive outcome and proceeds directly to that target.
- A bare-array `next` is a single positive outcome and proceeds to all targets in parallel.
- A map `next` names outcome labels (and error codes); every target it references must exist.
- Every `FlowError.code` a node declares should be a label in a map `next`; a node with
  declared errors cannot use the bare-string or bare-array form.
- Each node execution appends a `NodeRun`; during that execution the run and its tier runs
  are updated in place. A rework edge can route back to an earlier node, which appends a new
  `NodeRun` for the new execution.
- Nodes fail fast; there are no retries — but a tier that cannot confidently answer is not a
  node failure, it is an escalation.
- An error with no matching label (or a code the node did not declare) is unexpected, and the
  flow moves to `paused` for human intervention.
- For now, nodes run locally and return their result directly; no callback or correlation ID
  is involved.
