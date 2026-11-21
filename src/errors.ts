export type GraphIssue = {
  path: string;
  message: string;
};

export class GraphValidationError extends Error {
  readonly issues: GraphIssue[];

  constructor(issues: GraphIssue[]) {
    super(`Invalid definition:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`);
    this.name = 'GraphValidationError';
    this.issues = issues;
  }
}

