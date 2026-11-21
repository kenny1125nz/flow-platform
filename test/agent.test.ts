import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpencodeAgentHandler } from '../src/server/agent.js';
import type { AgentNode } from '../src/model.js';

const node: AgentNode = { id: 'agent', type: 'agent', instruction: 'do work' };

test('parses a structured result from the opencode output', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-agent-'));
  const bin = path.join(dir, 'fake-opencode');
  await writeFile(bin, '#!/bin/sh\necho \'{"outcome":"succeeded","label":"ok"}\'\n');
  await chmod(bin, 0o755);

  try {
    const handler = createOpencodeAgentHandler({ bin });
    const result = await handler(node, { flowInstanceId: 'flow-1', goal: { id: 'goal-1' }, context: {}, outputs: {} });

    assert.equal(result.outcome.status, 'succeeded');
    assert.equal(result.label, 'ok');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reports a failed result when the process exits non-zero without JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow-agent-'));
  const bin = path.join(dir, 'fake-opencode');
  await writeFile(bin, '#!/bin/sh\necho "boom" >&2\nexit 2\n');
  await chmod(bin, 0o755);

  try {
    const handler = createOpencodeAgentHandler({ bin });
    const result = await handler(node, { flowInstanceId: 'flow-1', goal: { id: 'goal-1' }, context: {}, outputs: {} });

    assert.equal(result.outcome.status, 'failed');
    assert.equal(result.error?.code, 'agent.failed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
