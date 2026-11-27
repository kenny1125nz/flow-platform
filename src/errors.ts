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

// Raised when an operator action (retry/skip/jump) is not valid for a run's current
// state — for example when the run is not paused or a step is still in flight.
export class OperatorActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorActionError';
  }
}

