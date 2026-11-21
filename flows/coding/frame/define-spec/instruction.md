Produce a task spec as structured JSON conforming to the TaskSpec schema defined in
`flows/coding/frame/define-spec/task-spec.schema.ts`:

- goal: a single unambiguous statement of what is true when done, plus explicit non-goals.
- constraints: non-negotiable decisions, such as a public API shape.
- scope: the files that may change, and a hard fence of files that must not change.
- acceptance criteria: machine-checkable conditions, each with how to verify it.
- evaluation: the build/test commands that determine done, plus any manual checks.

Do not prescribe the implementation approach; leave internal design choices to the
implementer. Do not modify files.

Write the JSON to `task-spec.json`, then verify it before finishing:

    npx tsx flows/coding/frame/define-spec/verify-spec.ts task-spec.json

Include the task spec as the `output` field of your final result line.
