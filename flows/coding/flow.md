# Coding Flow

Turns a loose goal into a landed code change through a fixed contract:

- **Frame** pins the task spec — goal, constraints, scope, acceptance criteria,
  evaluation — as structured data and publishes it to a GitHub issue.
- **Make** creates a feature branch from the issue, then implements within that
  contract, autonomously but inside the scope fence.
- **Verify** checks the result against the automated evaluation gate.
- **Deliver** commits the change and opens a pull request, then a human reviews it.
- **Land** squash-merges the pull request.

Human steps confirm readiness with evidence, never approval.
