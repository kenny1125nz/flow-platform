Review the task spec produced by `define-spec` (available in the upstream outputs) against
the contract a task spec must satisfy:

- goal: a single unambiguous statement of what is true when done, plus explicit non-goals.
- constraints: non-negotiable decisions, such as a public API shape.
- scope: the files that may change, and a hard fence of files that must not change.
- acceptance criteria: machine-checkable conditions, each with how to verify it.
- evaluation: the build/test commands that determine done, plus any manual checks.

Do not modify files. Produce a verdict: the spec is `ready` to proceed, or needs `rework`
(with concrete feedback about what is missing or unverifiable). Report a `confidence`
between 0 and 1 for your verdict — a lower confidence means a human reviewer must confirm.

Print one final JSON line:

{"outcome":"succeeded","label":"ready","confidence":0.9}

or

{"outcome":"succeeded","label":"rework","output":{"feedback":"<what must change>"},"confidence":0.9}
