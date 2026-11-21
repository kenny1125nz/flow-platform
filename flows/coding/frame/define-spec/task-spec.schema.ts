import { z } from 'zod';

// Schema for the TaskSpec the define-spec agent must emit. This is the contract the
// later stages read; every field is data, never free text, so it can be validated.

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),   // the verifiable condition
  verifyWith: z.string().min(1),  // how to produce the evidence: a command, a file, an observation
});

export const taskSpecSchema = z.object({
  goal: z.object({
    statement: z.string().min(1),   // a single unambiguous statement of what is true when done
    nonGoals: z.array(z.string()),  // explicit out-of-scope items
  }),
  constraints: z.array(z.string()), // non-negotiable decisions: public API shape, hard requirements
  scope: z.object({
    files: z.array(z.string()),         // files the change may touch
    mustNotChange: z.array(z.string()), // hard fence: files that must remain untouched
  }),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
  evaluation: z.object({
    commands: z.array(z.string()), // automated build/test commands that determine "done"
    manualChecks: z.array(z.string()), // human observations that cannot be automated
  }),
});

export type TaskSpec = z.infer<typeof taskSpecSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
