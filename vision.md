# Vision: Flow Execution Platform

A platform for running work as **flows**: ordered sets of units that may run one after
another or in parallel. The same idea is applied at two levels.

- A **flow** orchestrates nodes to complete a piece of work.
- A **plan** orchestrates whole flows — running flow instances — to complete a larger
  initiative.

Both are flows. They differ only in what their units are, and therefore in how much the
executor has to know.

Within a flow, every node is realized by one further idea: **each node is assigned the
executor best suited to the character of its task — script, agent, or human.** Code is used
when the work can be reduced to explicit rules; an agent when the work resists rules but can
be guided with a fixed toolset and checked against deterministic criteria; a person when the
work needs expert context, judgment, taste, feedback, or accountability. The choice is a
property of the task, not a verdict from historical statistics. Measurement still matters —
it keeps each executor honest and reveals when a task has become formal enough to re-author
— but it does not decide who runs a given step.

---

## 1. One idea, two levels

|                | Plan                                   | Flow                                |
|----------------|----------------------------------------|-------------------------------------|
| Represents     | a larger initiative                    | an individual piece of work         |
| Its units are  | running flow instances                 | nodes (each with its executor)      |
| Executor does  | start, track, and sequence flows       | run the nodes of one flow           |
| Looks inside?  | no — a flow is treated as a unit       | yes — the nodes are its concern     |

The plan level is deliberately simpler: its units are whole flow runs, so it only needs to
start them, follow their status, and move on in the right order. The flow level is richer:
its units are nodes, each executed by the executor that fits its task.

---

## 2. Units: nodes executed by the executor that fits

At the **flow** level, every node is the same shape: a goal, its **chosen executor**, a
routing map, and optional acceptance criteria and annotations.

The executor is selected by the characteristics of the task, not by which executor has
scored best historically:

- **Script (code) — formalizable work.** Use a script when the task can be abstracted into
  specific rules and a deterministic sequence of steps: given these inputs, perform these
  transformations, and accept when this condition holds. Whenever the rules can be stated
  honestly, code is the cheapest, fastest, and most reliable executor.
- **Agent — toolable judgment.** Use an agent when the task is hard to express as rules but
  still has a fixed set of tools and a known action space: the agent can be instructed,
  handed those tools, and — ideally — its result can be verified by deterministic criteria
  or logic. The deterministic check is what makes the agent safe: it exercises judgment,
  while acceptance stays objective.
- **Human — irreplaceable judgment.** Use a person when neither code nor an agent can carry
  the work, specifically when the value is (1) providing expert input that cannot be
  elicited another way — context, decisions, taste, feedback — or (2) accountability, where
  someone must own the outcome. A human is not a fallback for "hard" work; a human is the
  right executor for judgment and responsibility.

The executor is authored for the node, not guessed per run. A node may still declare an
escalation path for the case where its chosen executor cannot complete — an agent whose
output fails deterministic verification, or a script that meets a genuinely unformalized
edge — but escalation is an exception, not a competition among the three. Measurement of
results guides **re-authoring** (for example, when a recurring agent judgment has become
formal enough to express as a script); it does not select the executor for an individual
run.

**Autonomy is an explicit run-level input, not a statistical guess.** A run started with
`autonomy: autonomous` lets the engine drop human executors so the next cheaper executor
carries the work — useful when the goal is low-risk, such as a simple code fix. Policy can
still mark a node `requireHuman` (for example, `risk: structural`) to protect high-risk
steps from being delegated. A `supervised` run (the default) keeps the human anchor. In
both modes the executor is decided before the run from the node, the policy, and the run's
autonomy setting — never inferred from past performance mid-run. An autonomous run also does
**not gate on confidence**: the executor's verdict is accepted as-is so the flow keeps
moving, while declared errors still escalate or route.

There is no separate "gate" concept. A gate is just a node with acceptance criteria whose
outcomes happen to route to accepted / rejected / rework through its `next` map. Its special
property is *coverage* — the share of criteria formalized into deterministic checks — and
that its confidence is the deliverable.

At the **plan** level, the unit is simply a **running instance of a flow**.

Either way, a unit has a lifecycle the platform understands: running, paused, or ended. A
human-executed node is simply running until the person responds. This shared notion of state
is what lets the same platform, and the same presentation, work at both levels.

---

## 3. Definitions are data; policy is dynamic

Both a plan and a flow are described as data — JSON, constrained by a schema.

- The schema defines what a valid definition can be, and every definition is validated
  before it can be stored or run.
- A flow definition groups its nodes into stages and substages. Each node declares its
  executor — script, agent, or human — plus any fallback, and names its successor(s) —
  directly for one outcome, one or several in parallel, or by mapping labels (positive
  options and error codes) to nodes — defining order, branching, and error routing.
- A plan declares its sub-tasks as nodes, each a material goal paired with the flow that
  should achieve it, and uses the same successor mapping.

Because definitions are data, they are versionable, comparable, and checkable. An invalid
definition fails early, and nothing runs against it.

**How an executor's output is judged is not definition, it is policy** — also data, but
dynamic. A flow policy sets the acceptance bar for the chosen executor, whether its verdict
is binding, when escalation to a fallback is allowed, and whether a node **requires a
human** even in an autonomous run; its rules match node **annotations**
(`risk: structural`, `domain: coding`) so a whole class of work can be steered without
touching a definition. Policy tunes quality, escalation, and human-requirement behavior — it
never swaps the executor the task calls for.

---

## 4. Execution

A **Flow** loads a validated definition and executes its nodes as declared. Each node runs
through its **declared executor** (adjusted by the run's autonomy setting): resolve the
policy that governs acceptance, select the active executors, and accept an output when it
meets its bar. If the executor cannot complete, the node follows its declared fallback, if
any. The flow owns the state of the run — what is running, paused, or ended — and is the
single source of truth for how that flow progresses.

A **Plan** executes the same kind of idea, one level up: it starts running instances of
flows, tracks their status, runs independent ones in parallel, and does not look inside a
flow.

So the platform can be understood at both levels: a plan of flows, and within each flow, a
flow of nodes — and within each node, the executor that fits the work.

---

## 5. Dispatch, callbacks, and the message bus

For now, execution is local: an executor runs and **returns its result directly** to the
platform. The callback and message-bus design below is deferred until work moves off the
machine.

When execution may happen on another machine, **callbacks become a firm requirement**. The
platform hands off the work with a one-shot instruction and does not hold onto it; the
running work reports back through a **callback** carrying a **correlation ID**, and the
platform uses that ID to match the result to the waiting executor and continue the flow.

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

## 6. Reliability is designed per executor, and measured over time

Each executor is a serious engineering target, not an afterthought. An executor should
**manage exceptional scenarios as much as it reasonably can on its own** — handling known
edge cases and recovering where it is safe to do so. It **fails fast**; there are no retries.

Within a node, a failing executor is not automatically a node failure — if the node declares
a fallback, the work **escalates** to it. When a node as a whole cannot resolve a problem, it
must report a structured **error** rather than simply failing. The error describes what
happened and carries a **handling hint** — and that pair is the node's hand-off to the flow,
so the **flow can make a routing decision**: take an alternate path, fall back, or stop. The
hint can also be handed to an AI agent as instructions when an agent is the one that handles
the error.

**Expected errors are declared** as part of the node contract. Anything **unexpected** has
no matching route, so the platform does not guess — it **pauses for human intervention** and
surfaces the problem where people can see it.

At the plan level the same attitude applies to flows: a flow that cannot continue becomes
visible to the plan and to the people watching it, rather than silently stalling the
initiative.

### The measurement loop

Confidence can never reach 100% — but it can be **measured**, and measurement is how each
executor earns and keeps trust.

- Every executor run records its outcome, label, confidence, coverage, and escalation in the
  node's **run trace**.
- Traces aggregate into statistics: agreement between an automated verdict and the human
  check that samples it, escalation rates, and coverage.
- Measurement does **not** pick the executor for a run. It serves two purposes: it keeps
  every executor calibrated, and it is the signal that a task's character may have changed —
  for example, a recurring agent judgment that has become formal enough to re-author as a
  script. Moving work to a different executor is a deliberate re-authoring, reviewed like any
  other definition change, not an automatic per-run substitution.
- Calibration samples keep a human check arriving at a low rate, so trust in an automated
  verdict never silently drifts; a sampled human that disagrees **overrides** it.

The quality bar is the constraint; cost and time are the objective. The engine optimizes the
latter subject to the former, and never the other way around.

---

## 7. Observability is part of the run

The structured **step history** is not a side output — it is **part of the execution
instance itself**. Each run carries its own step history, which records what happened as it
happens, executor by executor.

The key metrics of each unit — when it ran, which executor carried it, how confident it was,
and how it turned out — are gathered inside those records, not measured separately afterward.

Because the steps belong to the run and are structured, the presentation can show exactly
what happened: progress, history, and health, at either level — the executors inside a node,
the nodes inside a flow, and the flows inside a plan. The statistics store turns the same
records into evidence for calibration and for deciding when a task has become formal enough
to re-author onto a cheaper executor.

---

## 8. Presentation

The web application is the human window into both levels. It presents:

- **Definitions** — plans and flows, viewable, editable, and validated.
- **Policies** — the per-flow rules that judge an executor's output and gate escalation.
- **Execution status** — each plan and each flow run, its units, current state, and run
  traces.
- **Statistics** — agreement, escalation, and coverage, as evidence for calibration and
  re-authoring.
- **Operator actions** — resolve human-executed nodes, step in where a flow needs attention,
  and follow or intervene in a plan.

For a flow, a **kanban board** shows runs by their **active executor** and state, with
columns for **Human**, **Agent**, **Script**, **Paused / Blocked**, and **Ended**. The column
is derived runtime state — where the run currently is — not a property anyone authored.

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
flows. And within a node, script, agent, and human are not competing fallbacks — each is the
right executor for a different character of work: code for rules, agents for tooled
judgment, people for context, taste, and accountability. Measurement keeps each executor
honest and tells us when a task's character has changed enough to re-author it, but the task
— not the statistics — chooses its executor.

See `architecture.md` for the components that realize this vision and `data-model.md` for
the concrete definitions, run traces, policies, and statistics.
