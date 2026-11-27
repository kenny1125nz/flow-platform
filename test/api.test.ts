import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { RunStore } from '../src/server/store.js';
import {
  StatsStore,
  createNodeExecutor,
  failed,
  HumanTaskBroker,
  succeeded,
  validateFlowDefinition,
} from '../src/index.js';
import type { RunDetail } from '../src/api-types.js';
import type { FlowDefinition, PlanDefinition } from '../src/model.js';

function makeApp() {
  const broker = new HumanTaskBroker();
  const stats = new StatsStore();
  const executor = createNodeExecutor(
    {
      script: async (_tier, context) => succeeded(context.nodeId),
      agent: async (_tier, context) => succeeded(context.nodeId === 'approve' ? 'approved' : context.nodeId),
      human: broker.handler,
    },
    { stats },
  );
  return { app: createApp({ broker, executor, seed: true, stats }), broker, stats };
}

// Minimal definitions used to exercise the run/plan endpoints without seeded data.
const simpleFlow: FlowDefinition = {
  id: 'simple',
  version: '1',
  stages: [
    {
      id: 'main',
      nodes: [
        { id: 'prepare', tiers: [{ kind: 'script', run: 'echo prepare' }], next: 'approve' },
        {
          id: 'approve',
          tiers: [{ kind: 'human', prompt: 'Approve?' }],
          next: { approved: 'deploy', rejected: 'cancel' },
        },
        { id: 'deploy', tiers: [{ kind: 'script', run: 'echo deploy' }] },
        { id: 'cancel', tiers: [{ kind: 'script', run: 'echo cancel' }] },
      ],
    },
  ],
};

const autoFlow: FlowDefinition = {
  id: 'auto',
  version: '1',
  stages: [
    {
      id: 'main',
      nodes: [
        { id: 'go', tiers: [{ kind: 'script', run: 'echo go' }], next: 'done' },
        { id: 'done', tiers: [{ kind: 'script', run: 'echo done' }] },
      ],
    },
  ],
};

const gateFlow: FlowDefinition = {
  id: 'gate',
  version: '1',
  stages: [
    {
      id: 'main',
      nodes: [
        {
          id: 'approve',
          tiers: [{ kind: 'agent', instruction: 'review' }, { kind: 'human', prompt: 'Approve?' }],
          next: { approved: 'deploy' },
        },
        { id: 'deploy', tiers: [{ kind: 'script', run: 'echo deploy' }] },
      ],
    },
  ],
};

const simplePlan: PlanDefinition = {
  id: 'simple-plan',
  version: '1',
  nodes: [
    { id: 'review', goal: { id: 'g', description: 'Review' }, flow: { id: 'auto', version: '1' }, next: 'release' },
    { id: 'release', goal: { id: 'g', description: 'Ship' }, flow: { id: 'gate', version: '1' } },
  ],
};

test('serves seeded definitions', async () => {
  const { app } = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/definitions' });

  assert.equal(response.statusCode, 200);
  const definitions = response.json() as { kind: string; id: string }[];
  assert.ok(definitions.some((definition) => definition.kind === 'flow' && definition.id === 'coding'));
  assert.ok(!definitions.some((definition) => definition.kind === 'plan'));
});

test('serves the seeded coding policy', async () => {
  const { app } = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/policies' });

  assert.equal(response.statusCode, 200);
  const policies = response.json() as { id: string; version: string }[];
  assert.ok(policies.some((policy) => policy.id === 'coding'));

  const coding = await app.inject({ method: 'GET', url: '/api/policies/coding/1' });
  assert.equal(coding.statusCode, 200);
  assert.equal((coding.json() as { id: string }).id, 'coding');
});

test('rejects invalid flow definitions', async () => {
  const { app } = makeApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/flows',
    payload: {
      id: 'bad',
      version: '1',
      stages: [{ id: 'main', nodes: [{ id: 'a', tiers: [{ kind: 'script', run: 'echo a' }], next: 'missing' }] }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'invalid definition');
});

test('runs a flow and resolves its human step', async () => {
  const { app } = makeApp();
  await app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'simple-1' } },
  });

  assert.equal(started.statusCode, 202);
  const { runId } = started.json() as { runId: string };

  const target = await waitForHumanStep(app, runId);
  const responded = await app.inject({
    method: 'POST',
    url: `/api/flow-runs/${target.flowInstanceId}/human/${target.nodeId}/respond`,
    payload: { outcome: 'succeeded', label: 'approved' },
  });
  assert.equal(responded.statusCode, 200);

  const detail = await waitForRun(app, runId);
  assert.equal(detail.kind, 'flow');
  assert.equal(detail.status, 'ended');
  assert.equal(detail.result?.label, 'deploy');
  assert.deepEqual(
    detail.kind === 'flow' ? detail.steps.map((step) => step.nodeId) : [],
    ['prepare', 'approve', 'deploy'],
  );
});

test('retries a paused flow run through the operator endpoint', async () => {
  let attempts = 0;
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      if (context.nodeId === 'flaky') {
        attempts += 1;
        return attempts === 1
          ? failed({ code: 'flaky.broke', message: 'first attempt' })
          : succeeded('recovered');
      }
      return succeeded(context.nodeId);
    },
  });
  const app = createApp({ executor, seed: false });
  const flakyFlow: FlowDefinition = {
    id: 'flaky',
    version: '1',
    stages: [
      {
        id: 'main',
        nodes: [
          { id: 'flaky', tiers: [{ kind: 'script', run: 'echo flaky' }], next: 'done' },
          { id: 'done', tiers: [{ kind: 'script', run: 'echo done' }] },
        ],
      },
    ],
  };
  await app.inject({ method: 'POST', url: '/api/flows', payload: flakyFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/flaky/1/runs',
    payload: { goal: { id: 'flaky-1' } },
  });
  const { runId } = started.json() as { runId: string };

  const paused = await waitForRun(app, runId);
  assert.equal(paused.status, 'paused');

  const operator = await app.inject({
    method: 'POST',
    url: `/api/flow-runs/${runId}/operator`,
    payload: { action: 'retry', nodeId: 'flaky' },
  });
  assert.equal(operator.statusCode, 200);

  const detail = await waitForRun(app, runId);
  assert.equal(detail.status, 'ended');
  if (detail.kind === 'flow') {
    assert.deepEqual(detail.steps.map((step) => step.nodeId), ['flaky', 'done']);
    assert.equal(detail.result?.outcome.status, 'succeeded');
  }
});

test('revives a reloaded paused run so it can be retried', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-runs-'));
  const flakyFlow: FlowDefinition = {
    id: 'flaky-reload',
    version: '1',
    stages: [
      {
        id: 'main',
        nodes: [
          { id: 'flaky', tiers: [{ kind: 'script', run: 'echo flaky' }], next: 'done' },
          { id: 'done', tiers: [{ kind: 'script', run: 'echo done' }] },
        ],
      },
    ],
  };

  try {
    const failing = createNodeExecutor({
      script: async () => failed({ code: 'flaky.broke', message: 'first attempt' }),
    });
    const first = createApp({ executor: failing, seed: false, runStore: new RunStore(dir) });
    await first.inject({ method: 'POST', url: '/api/flows', payload: flakyFlow });
    const started = await first.inject({
      method: 'POST',
      url: '/api/flows/flaky-reload/1/runs',
      payload: { goal: { id: 'reload-1' } },
    });
    const { runId } = started.json() as { runId: string };
    const paused = await waitForRun(first, runId);
    assert.equal(paused.status, 'paused');

    // A fresh app reloads the run from disk as a frozen instance.
    const succeeding = createNodeExecutor({
      script: async (_tier, context) => succeeded(context.nodeId),
    });
    const second = createApp({ executor: succeeding, seed: false, runStore: new RunStore(dir) });
    await second.inject({ method: 'POST', url: '/api/flows', payload: flakyFlow });

    const operator = await second.inject({
      method: 'POST',
      url: `/api/flow-runs/${runId}/operator`,
      payload: { action: 'retry', nodeId: 'flaky' },
    });
    assert.equal(operator.statusCode, 200);

    const detail = await waitForRun(second, runId);
    assert.equal(detail.status, 'ended');
    if (detail.kind === 'flow') {
      assert.deepEqual(detail.steps.map((step) => step.nodeId), ['flaky', 'done']);
      assert.equal(detail.result?.outcome.status, 'succeeded');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects operator actions on a run that is not paused', async () => {
  const { app } = makeApp();
  await app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'operator-reject' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(app, runId);

  const operator = await app.inject({
    method: 'POST',
    url: `/api/flow-runs/${runId}/operator`,
    payload: { action: 'skip', nodeId: 'approve' },
  });
  assert.equal(operator.statusCode, 409);
});

test('serves a valid coding flow with the expected stages', async () => {
  const { app } = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/flows/coding/1' });

  assert.equal(response.statusCode, 200);
  const definition = response.json() as FlowDefinition;
  validateFlowDefinition(definition);

  assert.deepEqual(
    definition.stages.map((stage) => stage.name),
    ['Frame', 'Make', 'Verify', 'Deliver', 'Land'],
  );
  assert.ok(definition.stages.every((stage) => stage.nodes.length > 0));
  assert.ok(
    definition.stages
      .flatMap((stage) => stage.nodes)
      .every((node) => node.tiers.length > 0),
  );
});

test('board returns flow instances with their current steps', async () => {
  const { app } = makeApp();
  await app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'board-test' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(app, runId);

  const response = await app.inject({ method: 'GET', url: '/api/board' });
  assert.equal(response.statusCode, 200);
  const runs = response.json() as RunDetail[];
  const run = runs.find((candidate) => candidate.id === runId);
  assert.ok(run);
  assert.equal(run.kind, 'flow');
  assert.ok(run.steps.some((step) => step.tiers.some((tier) => tier.kind === 'human' && tier.status === 'running')));
});

test('runs a plan and exposes nested flow runs', async () => {
  const { app } = makeApp();
  await app.inject({ method: 'POST', url: '/api/flows', payload: autoFlow });
  await app.inject({ method: 'POST', url: '/api/flows', payload: gateFlow });
  await app.inject({ method: 'POST', url: '/api/plans', payload: simplePlan });
  const started = await app.inject({ method: 'POST', url: '/api/plans/simple-plan/1/runs' });
  assert.equal(started.statusCode, 202);
  const { runId } = started.json() as { runId: string };

  const target = await waitForHumanStep(app, runId);
  await app.inject({
    method: 'POST',
    url: `/api/flow-runs/${target.flowInstanceId}/human/${target.nodeId}/respond`,
    payload: { outcome: 'succeeded', label: 'approved' },
  });

  const detail = await waitForRun(app, runId);
  assert.equal(detail.kind, 'plan');
  assert.equal(detail.status, 'ended');
  if (detail.kind === 'plan') {
    assert.deepEqual(detail.steps.map((step) => step.nodeId), ['review', 'release']);
    assert.ok(detail.steps.every((step) => step.flowStatus === 'ended'));
  }

  const flowRuns = await app.inject({ method: 'GET', url: '/api/flow-runs' });
  assert.equal(flowRuns.statusCode, 200);
  assert.ok((flowRuns.json() as unknown[]).length >= 2);
});

test('collects tier statistics from executed nodes', async () => {
  const { app } = makeApp();
  await app.inject({ method: 'POST', url: '/api/flows', payload: gateFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/gate/1/runs',
    payload: { goal: { id: 'stats-1' } },
  });
  assert.equal(started.statusCode, 202);
  const { runId } = started.json() as { runId: string };

  const target = await waitForHumanStep(app, runId);
  await app.inject({
    method: 'POST',
    url: `/api/flow-runs/${target.flowInstanceId}/human/${target.nodeId}/respond`,
    payload: { outcome: 'succeeded', label: 'approved' },
  });
  await waitForRun(app, runId);

  const response = await app.inject({ method: 'GET', url: '/api/stats' });
  assert.equal(response.statusCode, 200);
  const stats = response.json() as { entries: { key: string; runs: number; agreement: Record<string, { agreed: number; total: number }> }[] };
  const gateStat = stats.entries.find((entry) => entry.key === 'node:gate@1:approve');
  assert.ok(gateStat, 'expected stats for the gate node');
  assert.equal(gateStat.runs, 1);
  assert.equal(gateStat.agreement['agent-human']?.total, 1);
  assert.equal(gateStat.agreement['agent-human']?.agreed, 1);
});

test('returns 404 for unknown runs and human steps', async () => {
  const { app } = makeApp();
  const run = await app.inject({ method: 'GET', url: '/api/runs/does-not-exist' });
  assert.equal(run.statusCode, 404);

  const response = await app.inject({
    method: 'POST',
    url: '/api/flow-runs/nope/human/nope/respond',
    payload: { outcome: 'succeeded' },
  });
  assert.equal(response.statusCode, 404);
});

async function waitForHumanStep(
  app: ReturnType<typeof createApp>,
  runId: string,
): Promise<{ flowInstanceId: string; nodeId: string }> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    const detail = response.json() as RunDetail;

    if (detail.kind === 'flow') {
      const step = detail.steps.find(
        (candidate) => candidate.tiers.some((tier) => tier.kind === 'human' && tier.status === 'running'),
      );
      if (step) {
        return { flowInstanceId: detail.id, nodeId: step.nodeId };
      }
    } else {
      for (const step of detail.steps) {
        const human = step.steps?.find((candidate) =>
          candidate.tiers.some((tier) => tier.kind === 'human' && tier.status === 'running'),
        );
        if (human && step.flowInstanceId) {
          return { flowInstanceId: step.flowInstanceId, nodeId: human.nodeId };
        }
      }
    }

    await delay(10);
  }
  throw new Error('timed out waiting for a running human step');
}

async function waitForRun(app: ReturnType<typeof createApp>, runId: string): Promise<RunDetail> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: 'GET', url: `/api/runs/${runId}` });
    const detail = response.json() as RunDetail;
    if (detail.status === 'ended' || detail.status === 'paused') {
      return detail;
    }
    await delay(10);
  }
  throw new Error('timed out waiting for run');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
