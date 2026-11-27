import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { RunStore } from '../src/server/store.js';
import { createNodeExecutor, HumanTaskBroker, succeeded } from '../src/index.js';
import type { RunDetail } from '../src/api-types.js';
import type { FlowDefinition, PlanDefinition } from '../src/model.js';

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
  stages: [{ id: 'main', nodes: [{ id: 'go', tiers: [{ kind: 'script', run: 'echo go' }] }] }],
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
          tiers: [{ kind: 'human', prompt: 'Approve?' }],
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

function makeStore(): { dir: string } {
  return { dir: mkdtempSync(join(tmpdir(), 'flow-persistence-')) };
}

function makeApp(dir: string) {
  const broker = new HumanTaskBroker();
  const executor = createNodeExecutor({
    script: async (_tier, context) => succeeded(context.nodeId),
    agent: async (_tier, context) => succeeded(context.nodeId),
    human: broker.handler,
  });
  return { app: createApp({ broker, executor, seed: true, runStore: new RunStore(dir) }), broker };
}

test('persists a flow run to a JSON file identifiable by run id', async () => {
  const { dir } = makeStore();
  const { app } = makeApp(dir);
  await app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'persist-1' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(app, runId);

  const file = join(dir, `${runId}.json`);
  assert.ok(existsSync(file), `expected run file ${file} to exist`);
  const persisted = JSON.parse(readFileSync(file, 'utf8')) as { kind: string; instance: { id: string; steps: unknown[] } };
  assert.equal(persisted.kind, 'flow');
  assert.equal(persisted.instance.id, runId);
  assert.deepEqual(
    persisted.instance.steps.map((step) => (step as { nodeId: string }).nodeId),
    ['prepare', 'approve'],
  );
});

test('reloads a persisted flow run with identical content after restart', async () => {
  const { dir } = makeStore();
  const first = makeApp(dir);
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await first.app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'reload-1' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(first.app, runId);

  const before = await first.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  assert.equal(before.statusCode, 200);
  const beforeBody = before.json();

  const second = makeApp(dir);
  const after = await second.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), beforeBody);

  const list = await second.app.inject({ method: 'GET', url: '/api/runs' });
  assert.equal(list.statusCode, 200);
  assert.ok((list.json() as { id: string }[]).some((run) => run.id === runId));
});

test('round-trips the full flow instance model without loss', async () => {
  const { dir } = makeStore();
  const first = makeApp(dir);
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await first.app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'roundtrip-1' }, context: { repo: 'owner/repo', branch: 'feature' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(first.app, runId);

  const beforeDetail = await first.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  const beforeFlow = await first.app.inject({ method: 'GET', url: `/api/flow-runs/${runId}` });

  const second = makeApp(dir);
  const afterDetail = await second.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  const afterFlow = await second.app.inject({ method: 'GET', url: `/api/flow-runs/${runId}` });

  assert.deepEqual(afterDetail.json(), beforeDetail.json());
  assert.deepEqual(afterFlow.json(), beforeFlow.json());

  const detail = afterDetail.json() as RunDetail;
  if (detail.kind === 'flow') {
    assert.equal(detail.goal.id, 'roundtrip-1');
    assert.deepEqual(detail.context, { repo: 'owner/repo', branch: 'feature' });
    assert.ok(detail.createdAt);
    assert.ok(detail.updatedAt);
    assert.ok(detail.steps.every((step) => step.nodeId && step.status));
  }
});

test('persists plan runs including nested flow instances', async () => {
  const { dir } = makeStore();
  const first = makeApp(dir);
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: autoFlow });
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: gateFlow });
  await first.app.inject({ method: 'POST', url: '/api/plans', payload: simplePlan });
  const started = await first.app.inject({ method: 'POST', url: '/api/plans/simple-plan/1/runs' });
  const { runId } = started.json() as { runId: string };

  const target = await waitForHumanStep(first.app, runId);
  await first.app.inject({
    method: 'POST',
    url: `/api/flow-runs/${target.flowInstanceId}/human/${target.nodeId}/respond`,
    payload: { outcome: 'succeeded', label: 'approved' },
  });
  await waitForRun(first.app, runId);

  const before = await first.app.inject({ method: 'GET', url: `/api/plan-runs/${runId}` });
  assert.equal(before.statusCode, 200);
  const beforeBody = before.json();

  const second = makeApp(dir);
  const after = await second.app.inject({ method: 'GET', url: `/api/plan-runs/${runId}` });
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), beforeBody);

  const plan = after.json() as { kind: string; steps: { nodeId: string; flowInstanceId?: string; flowStatus?: string; steps?: unknown[] }[] };
  assert.equal(plan.kind, 'plan');
  assert.deepEqual(plan.steps.map((step) => step.nodeId), ['review', 'release']);
  assert.ok(plan.steps.every((step) => step.flowStatus === 'ended'));
  assert.ok(plan.steps.every((step) => step.flowInstanceId && step.steps && step.steps.length > 0));
});

test('persists step-level progress incrementally for a paused human step', async () => {
  const { dir } = makeStore();
  const first = makeApp(dir);
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await first.app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'incremental-1' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(first.app, runId);

  const second = makeApp(dir);
  const after = await second.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  const detail = after.json() as RunDetail;
  assert.equal(detail.kind, 'flow');
  if (detail.kind === 'flow') {
    const human = detail.steps.find((step) => step.tiers.some((tier) => tier.kind === 'human'));
    assert.ok(human);
    assert.equal(human.status, 'running');
    assert.ok(detail.steps.some((step) => step.nodeId === 'prepare' && step.status === 'ended'));
  }
});

test('loaded runs still serve the seeded coding definition', async () => {
  const { dir } = makeStore();
  const first = makeApp(dir);
  await first.app.inject({ method: 'POST', url: '/api/flows', payload: simpleFlow });
  const started = await first.app.inject({
    method: 'POST',
    url: '/api/flows/simple/1/runs',
    payload: { goal: { id: 'defs-1' } },
  });
  const { runId } = started.json() as { runId: string };
  await waitForHumanStep(first.app, runId);

  const second = makeApp(dir);
  const definitions = await second.app.inject({ method: 'GET', url: '/api/definitions' });
  assert.equal(definitions.statusCode, 200);
  assert.ok((definitions.json() as { kind: string; id: string }[]).some((d) => d.kind === 'flow' && d.id === 'coding'));

  const coding = await second.app.inject({ method: 'GET', url: '/api/flows/coding/1' });
  assert.equal(coding.statusCode, 200);

  const run = await second.app.inject({ method: 'GET', url: `/api/runs/${runId}` });
  assert.equal(run.statusCode, 200);
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
      const step = detail.steps.find((candidate) =>
        candidate.tiers.some((tier) => tier.kind === 'human' && tier.status === 'running'),
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
