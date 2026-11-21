import { spawn } from 'node:child_process';
import type { AgentNode, FlowError, OutcomeStatus, RunResult, TokenUsage } from '../model.js';
import type { NodeContext, NodeHandler } from '../runtime.js';
import { failed, succeeded } from '../result.js';

export type OpencodeAgentOptions = {
  bin?: string;
  model?: string;
  agent?: string;
  autoApprove?: boolean;
  cwd?: string;
};

export function createOpencodeAgentHandler(options: OpencodeAgentOptions = {}): NodeHandler<AgentNode> {
  return async (node, context) => {
    const instruction = withResultInstruction(node.instruction, context, node.id);
    const args = ['run', '--format', 'json'];

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
      cwd: context.context.workspace ?? options.cwd,
    });

    const parsed = parseJsonStream(result.stdout);
    if (parsed.result) {
      return parsed.usage ? { ...parsed.result, usage: parsed.usage } : parsed.result;
    }

    if (result.exitCode !== 0) {
      const failure = failed({
        code: 'agent.failed',
        message: result.stderr.trim() || `opencode exited with code ${result.exitCode ?? 'unknown'}`,
      });
      return parsed.usage ? { ...failure, usage: parsed.usage } : failure;
    }

    const success = succeeded();
    return parsed.usage ? { ...success, usage: parsed.usage } : success;
  };
}

function withResultInstruction(instruction: string, context: NodeContext, nodeId: string): string {
  const outputs =
    Object.keys(context.outputs).length > 0 ? JSON.stringify(context.outputs, null, 2) : '(none)';
  return [
    instruction,
    '',
    '---',
    `Flow context: instance ${context.flowInstanceId}, node ${nodeId}.`,
    `Goal: ${JSON.stringify(context.goal)}`,
    `Work context (repo, branch, workspace, issue): ${JSON.stringify(context.context)}`,
    'Upstream outputs (nodeId -> output):',
    outputs,
    'When finished, print one final line of JSON:',
    '{"outcome":"succeeded","label":"<short outcome label>","output":<optional structured output>}',
    'or',
    '{"outcome":"failed","error":{"code":"<code>","message":"<message>"}}',
  ].join('\n');
}

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

function runOpencode(bin: string, args: string[], options: { cwd?: string }): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function parseJsonStream(stdout: string): { result: RunResult | null; usage: TokenUsage | null } {
  const textParts: string[] = [];
  let usage: TokenUsage | null = null;

  for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event.type === 'text') {
      const part = event.part as { text?: unknown } | undefined;
      if (typeof part?.text === 'string') {
        textParts.push(part.text);
      }
    } else if (event.type === 'step_finish') {
      const part = event.part as
        | { tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } } }
        | undefined;
      const tokens = part?.tokens;
      if (tokens || typeof event.cost === 'number') {
        usage ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        usage.input += tokens?.input ?? 0;
        usage.output += tokens?.output ?? 0;
        usage.reasoning = (usage.reasoning ?? 0) + (tokens?.reasoning ?? 0);
        usage.cacheRead = (usage.cacheRead ?? 0) + (tokens?.cache?.read ?? 0);
        usage.cacheWrite = (usage.cacheWrite ?? 0) + (tokens?.cache?.write ?? 0);
        usage.cost = (usage.cost ?? 0) + (typeof event.cost === 'number' ? event.cost : 0);
      }
    }
  }

  return { result: parseAgentResult(textParts.join('\n')), usage };
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
  const output = 'output' in record ? record.output : undefined;

  return {
    outcome: { status: outcome },
    ...(label === undefined ? {} : { label }),
    ...(error === undefined ? {} : { error }),
    ...(output === undefined ? {} : { output }),
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
