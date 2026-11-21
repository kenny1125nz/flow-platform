# Vision: Flow Execution Platform

A platform for running work as **flows**: ordered sets of units that may run one after
another or in parallel. The same idea is applied at two levels.

- A **flow** orchestrates steps — human, AI agent, or script — to complete a piece of work.
- A **plan** orchestrates whole flows — running flow instances — to complete a larger
  initiative.

Both are flows. They differ only in what their units are, and therefore in how much the
executor has to know.

---

## 1. One idea, two levels

|                | Plan                                   | Flow                                |
|----------------|----------------------------------------|-------------------------------------|
| Represents     | a larger initiative                    | an individual piece of work         |
| Its units are  | running flow instances                 | human / agent / script steps        |
| Executor does  | start, track, and sequence flows       | run the steps of one flow           |
| Looks inside?  | no — a flow is treated as a unit       | yes — the steps are its concern     |

The plan level is deliberately simpler: its units are whole flow runs, so it only needs to
start them, follow their status, and move on in the right order. The flow level is richer:
its units are steps of three kinds, each with its own behavior and contract.

Everything below describes what both levels share, then the few places where they differ.

---

## 2. Units: steps and flows

At the **flow** level, every step is exactly one of three types:

- **Human** — a person acts through the web application: approvals, judgment calls, input.
- **AI agent** — an agent carries out a one-shot instruction: research, drafting, decisions.
- **Script** — software carries out the work: deterministic computation, integrations, jobs.

At the **plan** level, the unit is simply a **running instance of a flow**. The plan does not
care how that flow is built internally — only that it is running, needs attention, or has
finished.

Either way, a unit has a lifecycle the platform understands: running, paused, or ended. A
human step is simply running until the person responds. This shared notion of state is what
lets the same platform, and the same presentation, work at both levels.

---

## 3. Definitions are data

Both a plan and a flow are described as data — JSON, constrained by a schema.

- The schema defines what a valid definition can be, and every definition is validated
  before it can be stored or run.
- A flow definition groups its steps into stages and substages. Each node names its
  successor(s) — directly for one outcome, one or several in parallel, or by mapping labels
  (positive options and error codes) to nodes — defining order, branching, and error routing.
  The stages are logical grouping; each node's `next` carries the flow's relations.
- A plan declares its sub-tasks as nodes, each a material goal paired with the flow that should
  achieve it, and uses the same successor mapping — so order, parallelism, and error routing
  are explicit.

Because definitions are data, they are versionable, comparable, and checkable. An invalid
definition fails early, and nothing runs against it.

---

## 4. Execution

A **Flow** loads a validated definition and executes its steps as declared. It owns the state
of the run — what is running, paused, or ended — and is the single
source of truth for how that flow progresses.

A **Plan** executes the same kind of idea, one level up:

- It starts running instances of flows and tracks whether each is running, paused, or
  finished.
- It runs sub-tasks in the required order, and independent ones in parallel.
- It does not look inside a flow; what happens between steps stays the flow's concern.
- It decides what runs next, and moves the initiative forward.

So the platform can be understood at both levels: a plan of flows, and within each flow, a
flow of steps.

---

## 5. Dispatch, callbacks, and the message bus

For now, execution is local: a node runs and **returns its result directly** to the executor.
The callback and message-bus design below is deferred until work moves off the machine.

When execution may happen on another machine, **callbacks become a firm requirement**. The
platform hands off the work with a one-shot instruction and does not hold onto it; the running
work reports back through a **callback** carrying a **correlation ID**, and the platform uses
that ID to match the result to the waiting step and continue the flow.

At that point **a message bus** is also required. It carries dispatch and callbacks between
the platform and runners, so the two sides are decoupled and do not need to reach each other
directly. The bus is the connective tissue across the machine boundary; the platform never has
to know where the work actually ran.

At the plan level the same principle applies: starting a flow is a handoff, and the plan
observes the flow's status rather than holding onto it while it runs.

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

## 6. Reliability is designed per unit

Each step is a serious engineering target, not an afterthought. A step should **manage
exceptional scenarios as much as it reasonably can on its own** — handling known edge cases
and recovering where it is safe to do so. It **fails fast**; there are no retries.

When a step cannot resolve a problem itself, it must report a structured **error** rather
than simply failing. The error describes what happened and carries a **handling hint** — and
that pair is the step's hand-off to the flow, so the **flow can make a routing decision**:
take an alternate path, fall back, or stop. The flow routes on the error; there are no
retries. The hint can also be handed to an AI agent as instructions when an agent is the one
that handles the error.

**Expected errors are declared** as part of the step contract: they are the cases the author
anticipated, with their codes and hints. Anything **unexpected** has no matching route, so
the platform does not guess — it **pauses for human intervention** and surfaces the problem
where people can see it.

At the plan level the same attitude applies to flows: a flow that cannot continue becomes
visible to the plan and to the people watching it, rather than silently stalling the
initiative.

---

## 7. Observability is part of the run

The structured **step history** is not a side output — it is **part of the execution
instance itself**. Each run carries its own step history, which records what happened as it
happens.

The key metrics of each unit — when it ran and how it turned out — are gathered inside those
records, not measured separately afterward.

Because the steps belong to the run and are structured, the presentation can show
exactly what happened: progress, history, and health, at either level — the steps inside a
flow, and the flows inside a plan.

---

## 8. Presentation

The web application is the human window into both levels. It presents:

- **Definitions** — plans and flows, viewable, editable, and validated.
- **Execution status** — each plan and each flow run, its units, current state, and step
  records.
- **Operator actions** — resolve human steps, step in where a flow needs attention, and
  follow or intervene in a plan.

For a flow, a **kanban board** shows its steps by type and state, with columns for **Human**,
**Script**, **Agent**, **Paused / Blocked**, and **Ended**. Moving work between columns
reflects real progress, not a separate record kept alongside it.

For a plan, the presentation shows its sub-tasks — the flows that handle them — their order
and parallelism, and what is running, paused, or finished. A user can follow the initiative
as a whole and drill down from a sub-task into its underlying flow and steps.

The board and the plan view are the same idea at two levels: units moving through states,
made visible to the people who need to act on them.

---

## In summary

The platform is one idea applied twice: a definition of ordered units, an executor that runs
them, a reliable contract per unit, a structured record of what happened, and a presentation
that lets people see and act. Flows orchestrate steps; plans orchestrate flows.

See `architecture.md` for the components that realize this vision.
