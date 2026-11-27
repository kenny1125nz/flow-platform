import { spawn } from 'node:child_process';
import type { AgentTier, RunResult, TokenUsage } from '../model.js';
import { toRunResult } from '../parse-result.js';
import type { NodeContext, TierHandler } from '../runtime.js';
import { failed, succeeded } from '../result.js';

export type OpencodeAgentOptions = {
  bin?: string;
  model?: string;
  agent?: string;
  autoApprove?: boolean;
  cwd?: string;
};

export function createOpencodeAgentHandler(options: OpencodeAgentOptions = {}): TierHandler<AgentTier> {
  return async (tier, context) => {
    const instruction = withResultInstruction(tier.instruction, context);
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
    args.push('--title', `flow:${context.flowInstanceId}:${context.nodeId}`, instruction);

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

function withResultInstruction(instruction: string, context: NodeContext): string {
  const outputs =
    Object.keys(context.outputs).length > 0 ? JSON.stringify(context.outputs, null, 2) : '(none)';
  return [
    instruction,
    '',
    '---',
    `Flow context: instance ${context.flowInstanceId}, node ${context.nodeId}.`,
    `Goal: ${JSON.stringify(context.goal)}`,
    `Work context (repo, branch, workspace, issue): ${JSON.stringify(context.context)}`,
    'Upstream outputs (nodeId -> output):',
    outputs,
    'When finished, print one final line of JSON:',
    '{"outcome":"succeeded","label":"<short outcome label>","output":<optional structured output>,"confidence":<optional 0..1>}',
    'or',
    '{"outcome":"failed","error":{"code":"<code>","message":"<message>"}}',
    'When your verdict is uncertain, report a `confidence` between 0 and 1 so the flow',
    'can escalate to a human reviewer instead of trusting a guess.',
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
      const result = toRunResult(value, 'agent.error');
      if (result) {
        return result;
      }
    } catch {
      // keep scanning upward
    }
  }

  return null;
}
