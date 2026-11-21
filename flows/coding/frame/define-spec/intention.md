# define-spec

Frame the work: turn the incoming goal into a structured task spec that pins the
contract the implementer will work against.

Output: a `TaskSpec` — goal (statement + non-goals), constraints, scope (files + hard
fence), acceptance criteria (each with a verification method), and evaluation
(commands + manual checks).

The implementation approach is deliberately not prescribed; internal design choices are
left to the implementer. Emits structured JSON, never free text.
