import type { FlowError, OutcomeStatus, RunResult } from './model.js';

// Parses a RunResult from an untrusted JSON value (script stdout or agent output). A
// value counts as a result only when it carries one of outcome / label / error.
export function toRunResult(value: unknown, defaultErrorCode = 'node.error'): RunResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!('outcome' in record) && !('label' in record) && !('error' in record)) {
    return null;
  }

  const error = normalizeError(record.error, defaultErrorCode);
  const outcome = normalizeOutcome(record.outcome, error);
  const label = typeof record.label === 'string' ? record.label : undefined;
  const output = 'output' in record ? record.output : undefined;
  const confidence = typeof record.confidence === 'number' ? record.confidence : undefined;
  const coverage = typeof record.coverage === 'number' ? record.coverage : undefined;

  return {
    outcome: { status: outcome },
    ...(label === undefined ? {} : { label }),
    ...(error === undefined ? {} : { error }),
    ...(output === undefined ? {} : { output }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(coverage === undefined ? {} : { coverage }),
  };
}

export function normalizeOutcome(value: unknown, error: FlowError | undefined): OutcomeStatus {
  if (value === 'succeeded' || value === 'failed' || value === 'cancelled') {
    return value;
  }
  return error ? 'failed' : 'succeeded';
}

export function normalizeError(value: unknown, defaultCode = 'node.error'): FlowError | undefined {
  if (typeof value === 'string') {
    return { code: defaultCode, message: value };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : defaultCode;
  const message = typeof record.message === 'string' ? record.message : undefined;
  const hint = typeof record.hint === 'string' ? record.hint : undefined;

  return {
    code,
    ...(message === undefined ? {} : { message }),
    ...(hint === undefined ? {} : { hint }),
  };
}
