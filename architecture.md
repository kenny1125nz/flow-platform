# Architecture: Flow Execution Platform

This document describes the key components of the platform and how they fit together. It
builds on `vision.md`: the platform applies one idea — a definition of ordered units, an
executor that runs them, a step history that lives with the instance — at two levels, **Plan** and
**Flow**. Within a flow, one further idea applies to every node: **every step is the joint
effort of script, agent, and human**, executed as a cascade that escalates on confidence and
continuously optimizes cost and time against runtime statistics.

The architecture is deliberately split into a **control plane** (definitions, policies,
executors, state) and **runners** that may execute on other machines, connected by a
**message bus**.

---

## Component overview

```mermaid
flowchart TB
  subgraph Presentation
    Web[Web Application]
    Kanban[Flow Kanban Board]
    PlanView[Plan View]
  end

  subgraph Control["Control Plane"]
    DefStore[(Definition Store)]
    Validator[Definition Validator]
    PolicyStore[(Policy Store)]
    StatsStore[(Stats Store)]
    PlanExec[Plan Executor]
    FlowExec[Flow Executor]
    Cascade[Cascade Executor<br/>script → agent → human]
    ExecStore[(Execution Store<br/>instances + tier traces)]
    Gateway[Dispatch / Callback Gateway]
  end

  Bus[[Message Bus]]

  subgraph Runners["Runners (possibly remote)"]
    ScriptRunner[Script Runner]
    AgentRunner[Agent Runner]
  end

  People[People]

  Web --> Validator
  Validator --> DefStore
  DefStore --> PlanExec
  DefStore --> FlowExec
  PlanExec --> FlowExec
  FlowExec --> Cascade
  Cascade --> PolicyStore
  Cascade --> StatsStore
  StatsStore --> Cascade
  FlowExec --> ExecStore
  PlanExec --> ExecStore
  Cascade --> Gateway
  Gateway --> Bus
  Bus --> ScriptRunner
  Bus --> AgentRunner
  ScriptRunner --> Bus
  AgentRunner --> Bus
  Bus --> Gateway
  Gateway --> Cascade
  People --> Web
  Web --> ExecStore
  Web --> FlowExec
  Web --> PlanExec
```

---

## Key components

### 1. Definition Store

Holds **plan definitions** and **flow definitions** as JSON, together with their versions.

- A flow definition groups **nodes** into stages and substages; each node declares its
  **tier stack** — the script, agent, and human tiers that jointly carry out its goal — and
  names its successor(s) via `next`, so order, parallelism, and error routing are explicit.
- A plan definition is a set of nodes, each pairing a material goal with the flow that
  should achieve it; each node names its successor(s) the same way.
- Definitions are immutable-by-version: a run always refers to the exact version it started
  with.
- The store is the source of truth for *what should run*, never for *what is running*.

### 2. Definition Validator

Checks every definition against its schema before it is stored or used.

- Rejects invalid definitions early; nothing runs against them.
- Validates tier stacks: every node has at least one tier, and tier kinds are unique per
  node.
- Guarantees the executor can rely on the shape of what it loads.
- Can be used by the web application for live validation while authoring.

### 3. Policy Store

Holds **flow policies** — the dynamic half of execution. The definition declares the tier
stack; the policy decides how the tiers cooperate *today*.

- Per tier kind: an acceptance **bar** (minimum confidence) and whether the tier's verdict
  is **binding** or advisory.
- **Delegation** settings: the agreement threshold and minimum samples required before the
  human tier may be dropped, and the sampling rate that keeps calibration data flowing.
- **Rules** match node annotations (`when: { risk: 'structural' }`) and override the
  defaults — first match wins.
- Policies change far more often than definitions: raising a confidence bar never requires
  a new definition version.

### 4. Stats Store

Collects the runtime statistics that evolution is measured against. Every completed node
run feeds its tier trace in; the store aggregates per node and per annotation class.

- **Agreement** between the tier below human and the human anchor (outcome + label).
- **Escalations** — tier runs that fell below their bar.
- **Coverage** — the share of acceptance criteria formalized into deterministic checks.
- Persists alongside the execution store and is exposed at `GET /api/stats`.

### 5. Plan Executor

Orchestrates **flow instances** as the units of a larger initiative.

- Loads a plan definition and starts a **plan instance**.
- Creates a flow instance for each plan node's goal, tracks whether it is running, paused, or
  ended, and follows the node's `next` label to the next node.
- Treats each flow as a black box: it does not inspect the steps inside.

### 6. Flow Executor

Orchestrates the **nodes** of a single flow.

- Loads a flow definition and starts a **flow instance**.
- Owns the node state machine: running, paused, ended. A node whose human tier is waiting
  stays running until the person responds.
- Hands each node to the **cascade executor** and routes on the node's outcome and `next`
  exactly as before — nodes fail fast, errors route by code, unexpected errors pause the
  flow.
- Appends everything that happens — including the live tier trace — to the flow instance's
  steps.

### 7. Cascade Executor

The executor that realizes "every node is the joint effort of script, agent, and human".

- Sorts the node's tiers into canonical order: **script → agent → human**.
- Runs each tier in turn and accepts the **first** tier whose output meets its bar; a tier
  that fails its bar (or reports an error) **escalates** to the next tier. The human tier
  is the anchor and the last resort.
- Consults the stats store: when agreement with the human anchor has held long enough, the
  human tier is **delegated away** — except for random calibration samples that keep the
  measurement honest.
- A sampled human tier that disagrees with an accepted lower-tier verdict **overrides** it.
- Records every tier's contribution as a `TierRun`: outcome, label, confidence, coverage,
  escalation and sampling flags — the trace that makes evolution measurable.
- Reports tier progress live, so the presentation can show which tier is currently carrying
  the work.

### 8. Step Runners

Execute the work a tier hands off.

- **Script runner** — runs software: a job, container, or command.
- **Agent runner** — runs an AI agent against a one-shot instruction.
- Runners may live on other machines, which is why all communication goes over the bus.
- Runners are stateless from the platform's point of view: any runner can handle any
  dispatch it receives.

### 9. Dispatch / Callback Gateway

The boundary between the executors and the message bus. Absorbs late, duplicate, or unknown
callbacks without corrupting flow state.

**MVP simplification:** for the first version, callbacks are skipped entirely. The cascade
executor runs script and agent tiers locally and takes the result inline via a **direct local
shell call**. The gateway, message bus, and correlation IDs are introduced when execution
moves off the local machine.

### 10. Message Bus

The connective tissue across the machine boundary. Not present in the **MVP**, where local
shell calls replace the gateway and bus.

### 11. Execution Store

Holds **execution instances** and their steps — not definitions.

- A **flow instance** contains the goal it was started for and its steps; each step carries
  its tier trace.
- A **plan instance** contains the states of its flow instances and its own steps.
- Steps are part of the instance: the store persists them together so the run can
  always be replayed and presented.

### 12. Human Task Surface

The web application's handling of the **human tier**.

- Presents the tier's prompt, its inputs, and any context a person needs.
- Accepts the person's decision or result and resolves the tier in the flow executor.
- Keeps human work on the same lifecycle and step history as script and agent work — the
  human is a tier, not a separate kind of step.

### 13. Presentation Layer

The human window into both levels, reading from the execution store.

- **Web application** — definitions, policies, execution status, and operator actions.
- **Flow kanban board** — runs by their **active tier** and state, with columns for Human,
  Agent, Script, Paused / Blocked, and Ended. The column is derived runtime state, not
  authored structure.
- **Plan view** — plan nodes and the flow instances created for their goals.
- Operator actions go back to the executors, not directly to the store.

---

## The two loops

### Runtime loop — how the three cooperate

1. The flow executor hands a node to the cascade executor.
2. The cascade resolves the node's tier config from the policy (annotation rules first).
3. From the stats store it decides which tiers participate — dropping the human tier when
   agreement supports it, subject to calibration sampling.
4. It runs the tiers cheapest-first and accepts the first that meets its bar; the rest of
   the stack escalates as needed.
5. Every tier's contribution is recorded as a `TierRun` in the node run's trace.

### Evolution loop — how the platform moves down the delegation ladder

1. Traces accumulate in the stats store: agreement, escalations, coverage.
2. Once agreement with the human anchor holds above the policy threshold for enough
   samples, the engine delegates the human tier away for that node (or class).
3. Sampling keeps the anchor's verdict arriving at a low rate, so calibration stays honest
   and delegation can be **revoked** if agreement decays.
4. The same statistics justify moving work from agent to script: as coverage grows and
   escalation rates fall, more criteria are formalized into deterministic checks.

The quality bar is the constraint and cost/time is the objective: the engine only moves
down the human → agent → script ladder as fast as the statistics prove it can, and no
faster.

---

## Key interactions

### Authoring

1. A user edits a plan or flow definition in the web application.
2. The validator checks it against the schema and reports problems live.
3. A valid definition is stored as a new immutable version.

### Setting policy

1. A policy is PUT for a flow (`id@version`), or edited as data in the flow's folder.
2. Rules match node annotations; bars, binding, and delegation settings take effect on the
   next node execution — no definition change required.

### Running a node

1. The flow executor reaches a node and hands it to the cascade executor.
2. The cascade resolves policy, selects tiers, and runs them script → agent → human.
3. A tier that meets its bar finalizes the node; otherwise the next tier runs.
4. The trace is recorded live in the node run and fed to the stats store on completion.
5. The flow executor routes the node's outcome through `next` and continues.

### Running a human tier

1. The cascade escalates to the human tier and marks its tier run running.
2. The tier is exposed through the web application with its prompt and inputs.
3. A person acts on it; the response resolves the tier and the cascade (and the flow)
   continues.

### Error handling

1. A tier manages what it can, then fails fast and reports an **Error** object.
2. Within a node, a failing tier escalates to the next tier instead of failing the node.
3. A node whose last tier failed routes on the error's `code` through `next`.
4. An unrouted (unexpected) error pauses the flow for human intervention.

### Observing

1. The presentation reads instances and their tier traces from the execution store.
2. It shows status at both levels, the active tier per running step, and the history of
   what happened.
3. Stats are available at `/api/stats` for tuning policy.

---

## Deployment shape

- The **control plane** (validators, stores, executors, presentation) can run together or be
  scaled independently.
- **Runners** are separate and may be distributed across machines, connected only through
  the bus.
- Flow and plan instances are durable, so executors can pause or restart without losing the
  run. The stats store persists alongside the run store.
- In the **MVP**, everything runs locally: script and agent tiers are executed by a direct
  local shell call instead of being dispatched over the bus, so there is no separate runner
  tier yet.

---

## Open decisions

- Choice of message bus and delivery semantics.
- Choice of persistent store for definitions and instances.
- How much the platform minimizes resident resources (see `vision.md` §5).
- Whether plan and flow views share one board implementation or are distinct.
- How far the evolution loop should automate policy changes (today delegation is
  threshold-based; bandit-style tier selection is the natural upgrade path).

See `data-model.md` for the concrete definitions, instances, tier traces, policies, and
statistics.
