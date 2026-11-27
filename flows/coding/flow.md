# Coding Flow

Turns a loose goal into a landed code change through a fixed contract:

- **Frame** pins the task spec — goal, constraints, scope, acceptance criteria,
  evaluation — as structured data and publishes it to a GitHub issue.
- **Make** creates a feature branch from the issue, then implements within that
  contract, autonomously but inside the scope fence.
- **Verify** checks the result against the automated evaluation gate.
- **Deliver** commits the change and opens a pull request, then a reviewer confirms it.
- **Land** squash-merges the pull request.

Confirmation nodes are human-executed because the decision carries **accountability**: an
agent may pre-analyze the spec or results and report a confidence, but the person owns the
verdict — they supply the context, judgment, and sign-off that the work is acceptable.
Deterministic checks belong in the script tier, which is why `verify` runs automatically
before any person is asked to confirm.

A run started with `autonomy: autonomous` (e.g. a simple code fix) lets the agent take over
those confirmation steps; a policy rule can still set `requireHuman` for high-risk work
(`risk: structural`) so a person always signs off there.
