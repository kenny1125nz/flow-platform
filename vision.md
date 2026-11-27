# Vision: Flow Execution Platform

A platform for running work as **flows**: ordered sets of units that may run one after
another or in parallel. The same idea is applied at two levels.

- A **flow** orchestrates nodes to complete a piece of work.
- A **plan** orchestrates whole flows — running flow instances — to complete a larger
  initiative.

Both are flows. They differ only in what their units are, and therefore in how much the
executor has to know.

Within a flow, every node is realized by one further idea: **a node is not typed as human,
agent, or script — it is the joint effort of all three.** Each node declares a tier stack
(script → agent → human), executed cheapest-first, escalating on confidence, with the human
as the anchor and last resort. The platform measures every tier's contribution and uses that
statistics to continuously move work down the ladder — from human to agent to script — as
fast as the evidence allows, subject to a declared quality bar.

---

## 1. One idea, two levels

|                | Plan                                   | Flow                                |
|----------------|----------------------------------------|-------------------------------------|
| Represents     | a larger initiative                    | an individual piece of work         |
| Its units are  | running flow instances                 | nodes (each a tier stack)           |
| Executor does  | start, track, and sequence flows       | run the nodes of one flow           |
| Looks inside?  | no — a flow is treated as a unit       | yes — the nodes are its concern     |

The plan level is deliberately simpler: its units are whole flow runs, so it only needs to
start them, follow their status, and move on in the right order. The flow level is richer:
its units are nodes, each executed as a cascade of tiers.

---

## 2. Units: nodes as the joint effort of three

At the **flow** level, every node is the same shape: a goal, a **tier stack**, a routing
map, and optional acceptance criteria and annotations.

- **Script tier** — deterministic work: a command, an integration, a check.
- **Agent tier** — judgment work: a one-shot instruction, producing an outcome, a label,
  and a **confidence** in its verdict.
- **Human tier** — the anchor: authority and accountability, with a prompt and an assignee.

The tiers cooperate in canonical order — **script → agent → human** — trying to cover as
much as possible with the earlier, cheaper tiers, and avoiding the later ones when coverage
and confidence are sufficient. The cascade accepts the first tier that meets its
**acceptance bar**; a tier that cannot confidently answer **escalates** to the next one.

There is no separate "gate" concept. A gate is just a node with acceptance criteria whose
outcomes happen to route to accepted / rejected / rework through its `next` map. Its special
property is *coverage* — the share of criteria formalized into deterministic checks — and
that its confidence is the deliverable.

At the **plan** level, the unit is simply a **running instance of a flow**.

Either way, a unit has a lifecycle the platform understands: running, paused, or ended. A
human tier is simply running until the person responds. This shared notion of state is what
lets the same platform, and the same presentation, work at both levels.

---

## 3. Definitions are data; policy is dynamic

Both a plan and a flow are described as data — JSON, constrained by a schema.

- The schema defines what a valid definition can be, and every definition is validated
  before it can be stored or run.
- A flow definition groups its nodes into stages and substages. Each node declares its tier
  stack and names its successor(s) — directly for one outcome, one or several in parallel,
  or by mapping labels (positive options and error codes) to nodes — defining order,
  branching, and error routing.
- A plan declares its sub-tasks as nodes, each a material goal paired with the flow that
  should achieve it, and uses the same successor mapping.

Because definitions are data, they are versionable, comparable, and checkable. An invalid
definition fails early, and nothing runs against it.

**How the tiers cooperate is not definition, it is policy** — also data, but dynamic. A flow
policy sets the acceptance bar per tier, whether a tier's verdict is binding, and the
delegation thresholds; its rules match node **annotations** (`risk: structural`,
`domain: coding`) so a whole class of work can be steered without touching a definition.
Raising a confidence bar never requires a new definition version.

---

## 4. Execution

A **Flow** loads a validated definition and executes its nodes as declared. Each node runs
through the **cascade executor**: resolve policy, select tiers, run script → agent → human,
accept the first that meets its bar. The flow owns the state of the run — what is running,
paused, or ended — and is the single source of truth for how that flow progresses.

A **Plan** executes the same kind of idea, one level up: it starts running instances of
flows, tracks their status, runs independent ones in parallel, and does not look inside a
flow.

So the platform can be understood at both levels: a plan of flows, and within each flow, a
flow of nodes — and within each node, a cascade of tiers.

---

## 5. Dispatch, callbacks, and the message bus

For now, execution is local: a tier runs and **returns its result directly** to the
executor. The callback and message-bus design below is deferred until work moves off the
machine.

When execution may happen on another machine, **callbacks become a firm requirement**. The
platform hands off the work with a one-shot instruction and does not hold onto it; the
running work reports back through a **callback** carrying a **correlation ID**, and the
platform uses that ID to match the result to the waiting tier and continue the flow.

At that point **a message bus** is also required. It carries dispatch and callbacks between
the platform and runners, so the two sides are decoupled and do not need to reach each other
directly. The bus is the connective tissue across the machine boundary; the platform never has
to know where the work actually ran.

### Open: how far to minimize resident resources

One idea remains open: how strictly the platform should avoid waiting, in order to hold the
least possible system resources (threads). Callbacks and the bus belong to the eventual
design; what is still to be finalized is the trade-off between:

- **Returns** — fewer blocked threads, higher concurrency, and better scalability.
- **Complexity** — correlation, idempotency, late or duplicate callbacks, and the tooling to
  debug all of it.

The vision commits to handoff; callbacks, correlation, and the bus come with off-machine
execution. The exact resource target will be decided once this trade-off is analyzed.

---

## 6. Reliability is designed per tier, and evolves by measurement

Each tier is a serious engineering target, not an afterthought. A tier should **manage
exceptional scenarios as much as it reasonably can on its own** — handling known edge cases
and recovering where it is safe to do so. It **fails fast**; there are no retries.

Within a node, a failing tier is not a node failure — it is an **escalation**. The cascade
moves to the next tier, and the human anchor is the last resort. When a node as a whole
cannot resolve a problem, it must report a structured **error** rather than simply failing.
The error describes what happened and carries a **handling hint** — and that pair is the
node's hand-off to the flow, so the **flow can make a routing decision**: take an alternate
path, fall back, or stop. The hint can also be handed to an AI agent as instructions when an
agent is the one that handles the error.

**Expected errors are declared** as part of the node contract. Anything **unexpected** has
no matching route, so the platform does not guess — it **pauses for human intervention** and
surfaces the problem where people can see it.

At the plan level the same attitude applies to flows: a flow that cannot continue becomes
visible to the plan and to the people watching it, rather than silently stalling the
initiative.

### The evolution loop

Confidence can never reach 100% — but it can be **measured**, and the measurement is what
moves work down the ladder.

- Every tier run records its outcome, label, confidence, coverage, and escalation in the
  node's **tier trace**.
- Traces aggregate into statistics: **agreement** between the tier below human and the
  human anchor, escalation rates, and coverage.
- When agreement holds above the policy threshold for enough samples, the engine
  **delegates the human tier away** — except for a small rate of calibration **samples**,
  which keep the anchor's verdict arriving so the measurement never drifts.
- A sampled human tier that disagrees with a delegated verdict **overrides** it.

The quality bar is the constraint; cost and time are the objective. The engine optimizes
the latter subject to the former, and never the other way around.

---

## 7. Observability is part of the run

The structured **step history** is not a side output — it is **part of the execution
instance itself**. Each run carries its own step history, which records what happened as it
happens, tier by tier.

The key metrics of each unit — when it ran, which tier carried it, how confident it was, and
how it turned out — are gathered inside those records, not measured separately afterward.

Because the steps belong to the run and are structured, the presentation can show exactly
what happened: progress, history, and health, at either level — the tiers inside a node, the
nodes inside a flow, and the flows inside a plan. The statistics store turns the same
records into the evidence that drives delegation.

---

## 8. Presentation

The web application is the human window into both levels. It presents:

- **Definitions** — plans and flows, viewable, editable, and validated.
- **Policies** — the per-flow rules that steer tier cooperation.
- **Execution status** — each plan and each flow run, its units, current state, and tier
  traces.
- **Statistics** — agreement, escalation, and coverage, as the evidence for evolution.
- **Operator actions** — resolve human tiers, step in where a flow needs attention, and
  follow or intervene in a plan.

For a flow, a **kanban board** shows runs by their **active tier** and state, with columns
for **Human**, **Agent**, **Script**, **Paused / Blocked**, and **Ended**. The column is
derived runtime state — where the run currently is — not a property anyone authored.

For a plan, the presentation shows its sub-tasks — the flows that handle them — their order
and parallelism, and what is running, paused, or finished. A user can follow the initiative
as a whole and drill down from a sub-task into its underlying flow and steps.

The board and the plan view are the same idea at two levels: units moving through states,
made visible to the people who need to act on them.

---

## In summary

The platform is one idea applied twice: a definition of ordered units, an executor that
runs them, a reliable contract per unit, a structured record of what happened, and a
presentation that lets people see and act. Flows orchestrate nodes; plans orchestrate
flows. And within a node, script, agent, and human are not three kinds of work — they are
three tiers of one joint effort, with the engine measuring every step so the work can keep
moving down the ladder, as fast as the evidence allows.

See `architecture.md` for the components that realize this vision and `data-model.md` for
the concrete definitions, tier traces, policies, and statistics.
