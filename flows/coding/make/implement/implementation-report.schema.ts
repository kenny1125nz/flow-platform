import { z } from 'zod';

// The implement agent reports how it satisfied each acceptance criterion, with evidence,
// so the downstream confirm-verify step can check it criterion-by-criterion.

export const criterionReportSchema = z.object({
  criterionId: z.string().min(1),
  satisfied: z.boolean(),
  evidence: z.string().min(1), // how this criterion was met: a file, a test, an observation
});

export const evaluationReportSchema = z.object({
  command: z.string().min(1),
  passed: z.boolean(),
  output: z.string(), // the tail of the command output
});

export const implementationReportSchema = z.object({
  summary: z.string().min(1), // what changed and why
  filesChanged: z.array(z.string()),
  criteria: z.array(criterionReportSchema).min(1),
  evaluation: z.array(evaluationReportSchema),
});

export type ImplementationReport = z.infer<typeof implementationReportSchema>;
export type CriterionReport = z.infer<typeof criterionReportSchema>;
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;
