import { spawn } from 'node:child_process';
import type { AgentNode, FlowError, OutcomeStatus, RunResult } from '../model.js';
import type { NodeHandler } from '../runtime.js';
import { failed, succeeded } from '../result.js';

export type OpencodeAgentOptions = {
  bin?: string;
  model?: string;
  agent?: string;
  autoApprove?: boolean;
  timeoutMs?: number;
  cwd?: string;
};

export function createOpencodeAgentHandler(options: OpencodeAgentOptions = {}): NodeHandler<AgentNode> {
  return async (node, context) => {
    const instruction = withResultInstruction(node.instruction, context.flowInstanceId, node.id);
    const args = ['run'];

    if (options.model) {
      args.push('--model', options.model);
    }
    if (options.agent) {
      args.push('--agent', options.agent);
    }
    if (options.autoApprove) {
      args.push('--auto');
    }
    args.push('--title', `flow:${context.flowInstanceId}:${node.id}`, instruction);

    const result = await runOpencode(options.bin ?? 'opencode', args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 120_000,
    });

    const parsed = parseAgentResult(result.stdout);
    if (parsed) {
      return parsed;
    }

    if (result.exitCode !== 0) {
      return failed({
        code: 'agent.failed',
        message: result.stderr.trim() || `opencode exited with code ${result.exitCode ?? 'unknown'}`,
      });
    }

    return succeeded();
  };
}

function withResultInstruction(instruction: string, flowInstanceId: string, nodeId: string): string {
  return [
    instruction,
    '',
    '---',
    `Flow context: instance ${flowInstanceId}, node ${nodeId}.`,
    'When finished, print one final line of JSON:',
    '{"outcome":"succeeded","label":"<short outcome label>"}',
    'or',
    '{"outcome":"failed","error":{"code":"<code>","message":"<message>"}}',
  ].join('\n');
}

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

function runOpencode(bin: string, args: string[], options: { cwd?: string; timeoutMs: number }): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function parseAgentResult(stdout: string): RunResult | null {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');

  for (let start = lines.length - 1; start >= 0; start -= 1) {
    const candidate = lines.slice(start).join('\n').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (!candidate.startsWith('{')) {
      continue;
    }

    try {
      const value: unknown = JSON.parse(candidate);
      const result = toRunResult(value);
      if (result) {
        return result;
      }
    } catch {
      // keep scanning upward
    }
  }

  return null;
}

function toRunResult(value: unknown): RunResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!('outcome' in record) && !('label' in record) && !('error' in record)) {
    return null;
  }

  const error = normalizeError(record.error);
  const outcome = normalizeOutcome(record.outcome, error);
  const label = typeof record.label === 'string' ? record.label : undefined;

  return {
    outcome: { status: outcome },
    ...(label === undefined ? {} : { label }),
    ...(error === undefined ? {} : { error }),
  };
}

function normalizeOutcome(value: unknown, error: FlowError | undefined): OutcomeStatus {
  if (value === 'succeeded' || value === 'failed' || value === 'cancelled') {
    return value;
  }
  return error ? 'failed' : 'succeeded';
}

function normalizeError(value: unknown): FlowError | undefined {
  if (typeof value === 'string') {
    return { code: 'agent.error', message: value };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : 'agent.error';
  const message = typeof record.message === 'string' ? record.message : undefined;
  const hint = typeof record.hint === 'string' ? record.hint : undefined;

  return {
    code,
    ...(message === undefined ? {} : { message }),
    ...(hint === undefined ? {} : { hint }),
  };
}
