import type { FlowError, RunResult } from './model.js';

export function succeeded(label?: string, metrics?: Record<string, unknown>): RunResult {
  return {
    outcome: metrics ? { status: 'succeeded', metrics } : { status: 'succeeded' },
    ...(label === undefined ? {} : { label }),
  };
}

export function failed(error: FlowError, metrics?: Record<string, unknown>): RunResult {
  return {
    outcome: metrics ? { status: 'failed', metrics } : { status: 'failed' },
    error,
  };
}

export function cancelled(label?: string, metrics?: Record<string, unknown>): RunResult {
  return {
    outcome: metrics ? { status: 'cancelled', metrics } : { status: 'cancelled' },
    ...(label === undefined ? {} : { label }),
  };
}
