import type { OutcomeStatus } from './model.js';

// The contract a step-local human-step renderer implements. The web application
// resolves a renderer for a human step (see web/src/renderers.tsx) and renders it in
// place of the generic decision form.
export type HumanStepRendererProps = {
  flowInstanceId: string;
  nodeId: string;
  prompt: string;
  // Outputs of completed upstream nodes, keyed by node id (e.g. the TaskSpec produced
  // by `define-spec`).
  inputs: Readonly<Record<string, unknown>>;
  submit: (result: HumanStepResult) => Promise<void>;
};

export type HumanStepResult = {
  outcome: OutcomeStatus;
  label?: string;
  data?: unknown;
};
