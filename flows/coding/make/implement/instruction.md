The task spec lives in a GitHub issue created by the Frame stage. The upstream
`create-ticket` output (in the flow context) contains the issue number. Fetch the spec:

    node flows/coding/make/implement/read-ticket.mjs <issue-number>

This prints the task spec (goal, constraints, scope, acceptance criteria, evaluation).
Implement within the scope, satisfying every acceptance criterion, and run the
evaluation commands to verify your work. Do not change files outside the scope fence.

If this is a rework — the upstream outputs contain a prior `confirm-verify` or
`pr-review` output with a `rework` label and `feedback` — read that feedback and address
it explicitly in addition to the task spec. Prefer fixing the flagged issues over
starting over.

After implementing, produce an implementation report as structured JSON conforming to
the schema in `flows/coding/make/implement/implementation-report.schema.ts`:

- summary: what changed and why.
- filesChanged: the files you modified.
- criteria: one entry per acceptance criterion — whether it is satisfied and the
  concrete evidence for it.
- evaluation: each command you ran, whether it passed, and the tail of its output.

Write the JSON to `implementation-report.json`, then verify it before finishing:

    npx tsx flows/coding/make/implement/verify-report.ts implementation-report.json

Include the report as the `output` field of your final result line.
