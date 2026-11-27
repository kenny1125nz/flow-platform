import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FlowRunner,
  PolicyStore,
  StatsStore,
  createNodeExecutor,
  failed,
  makePolicy,
  succeeded,
} from '../src/index.js';
import type { FlowDefinition, FlowNode, TierRun } from '../src/index.js';

function flow(nodes: FlowNode[]): FlowDefinition {
  return {
    id: 'flow',
    version: '1',
    stages: [{ id: 'main', nodes }],
  };
}

function gateNode(next?: FlowNode['next'], annotations?: Record<string, string>): FlowNode {
  return {
    id: 'gate',
    tiers: [{ kind: 'agent', instruction: 'review' }, { kind: 'human', prompt: 'confirm?' }],
    ...(annotations === undefined ? {} : { annotations }),
    ...(next === undefined ? {} : { next }),
  };
}

function executorWith(
  handlers: Partial<Parameters<typeof createNodeExecutor>[0]>,
  options: Parameters<typeof createNodeExecutor>[1] = {},
) {
  const resolved = {
    script: async (_tier: unknown, _context: unknown) => succeeded('script-done'),
    agent: async (_tier: unknown, _context: unknown) => succeeded('agent-done'),
    human: async (_tier: unknown, _context: unknown) => succeeded('human-done'),
    ...handlers,
  };
  return createNodeExecutor(resolved as Parameters<typeof createNodeExecutor>[0], options);
}

test('escalates from agent to human when the agent confidence is below the bar', async () => {
  const order: string[] = [];
  const policy = makePolicy('p', '1', { qualityBar: 0.9 });
  const executor = executorWith(
    {
      agent: async (_tier, context) => {
        order.push(context.nodeId);
        return { ...succeeded('ready'), confidence: 0.5 };
      },
      human: async (_tier, context) => {
        order.push(`human:${context.nodeId}`);
        return succeeded('ready');
      },
    },
    { policy },
  );

  const instance = new FlowRunner({
    definition: flow([gateNode()]),
    goal: { id: 'g' },
    executor,
  });
  const result = await instance.execute();

  assert.equal(result.label, 'ready');
  assert.deepEqual(order, ['gate', 'human:gate']);

  const trace = instance.steps[0].tiers;
  assert.equal(trace[0].kind, 'agent');
  assert.equal(trace[0].escalated, true);
  assert.equal(trace[0].confidence, 0.5);
  assert.equal(trace[1].kind, 'human');
  assert.equal(trace[1].escalated, false);
});

test('accepts the agent verdict when its confidence meets the bar', async () => {
  const policy = makePolicy('p', '1', { qualityBar: 0.8 });
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async () => succeeded('ready'),
    },
    { policy },
  );

  const instance = new FlowRunner({ definition: flow([gateNode()]), goal: { id: 'g' }, executor });
  const result = await instance.execute();

  // The agent met the bar, so its verdict is the node's result. Without statistics there
  // is no delegation yet, so the human anchor still runs — as a calibration sample.
  assert.equal(result.label, 'ready');
  assert.equal(instance.steps[0].tiers.length, 2);
  assert.equal(instance.steps[0].tiers[0].kind, 'agent');
  assert.equal(instance.steps[0].tiers[0].escalated, false);
  assert.equal(instance.steps[0].tiers[1].kind, 'human');
  assert.equal(instance.steps[0].tiers[1].sampled, true);
});

test('treats an advisory tier as never finalizing the node', async () => {
  const policy = makePolicy('p', '1', { config: { bar: {}, binding: { agent: false } } });
  const order: string[] = [];
  const executor = executorWith(
    {
      agent: async (_tier, context) => {
        order.push('agent');
        return { ...succeeded('agent-says'), confidence: 1 };
      },
      human: async (_tier, context) => {
        order.push('human');
        return succeeded('human-says');
      },
    },
    { policy },
  );

  const instance = new FlowRunner({ definition: flow([gateNode()]), goal: { id: 'g' }, executor });
  const result = await instance.execute();

  assert.equal(result.label, 'human-says');
  assert.deepEqual(order, ['agent', 'human']);
  assert.equal(instance.steps[0].tiers[0].advisory, true);
});

test('delegates the human tier away once the agent agrees with the human anchor enough', async () => {
  const policy = makePolicy('p', '1', {
    delegation: { agreement: 0.9, minSamples: 3, sampling: 0 },
  });
  const stats = new StatsStore();
  const humanRuns: string[] = [];
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async (_tier, context) => {
        humanRuns.push(context.nodeId);
        return succeeded('ready');
      },
    },
    { policy, stats },
  );

  // Three runs with the human tier present: the agent and human agree every time.
  for (let index = 0; index < 3; index += 1) {
    const instance = new FlowRunner({
      definition: flow([gateNode()]),
      goal: { id: `g-${index}` },
      executor,
    });
    await instance.execute();
  }
  assert.equal(humanRuns.length, 3);

  // The fourth run has enough agreement samples to delegate: no human tier.
  const instance = new FlowRunner({
    definition: flow([gateNode()]),
    goal: { id: 'g-delegated' },
    executor,
  });
  await instance.execute();
  assert.equal(humanRuns.length, 3);
  assert.equal(instance.steps[0].tiers.length, 1);
  assert.equal(instance.steps[0].tiers[0].kind, 'agent');
});

test('does not delegate while the agent and human disagree', async () => {
  const policy = makePolicy('p', '1', {
    delegation: { agreement: 0.9, minSamples: 3, sampling: 0 },
  });
  const stats = new StatsStore();
  let agentSaysRework = true;
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded(agentSaysRework ? 'rework' : 'ready'), confidence: 0.95 }),
      human: async () => succeeded('ready'),
    },
    { policy, stats },
  );

  for (let index = 0; index < 5; index += 1) {
    if (index === 3) {
      agentSaysRework = false;
    }
    const instance = new FlowRunner({
      definition: flow([gateNode()]),
      goal: { id: `g-${index}` },
      executor,
    });
    await instance.execute();
    // The human tier must be present in every run: agreement never reaches 0.9 overall
    // within any window, so delegation never kicks in.
    assert.equal(instance.steps[0].tiers.length, 2);
  }
});

test('samples the human tier after delegation to keep calibration data flowing', async () => {
  const policy = makePolicy('p', '1', {
    delegation: { agreement: 0.9, minSamples: 3, sampling: 1 },
  });
  const stats = new StatsStore();
  let sampled = 0;
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async (_tier, context) => {
        sampled += 1;
        return succeeded('ready');
      },
    },
    { policy, stats, random: () => 0 }, // random() < sampling(1) is always true
  );

  for (let index = 0; index < 3; index += 1) {
    const instance = new FlowRunner({
      definition: flow([gateNode()]),
      goal: { id: `g-${index}` },
      executor,
    });
    await instance.execute();
  }

  const instance = new FlowRunner({
    definition: flow([gateNode()]),
    goal: { id: 'g-sampled' },
    executor,
  });
  await instance.execute();

  assert.equal(sampled, 4);
  assert.equal(instance.steps[0].tiers.length, 2);
  assert.equal(instance.steps[0].tiers[1].sampled, true);
});

test('prefers the human verdict when the sampled human disagrees', async () => {
  const policy = makePolicy('p', '1', {
    delegation: { agreement: 0.9, minSamples: 3, sampling: 1 },
  });
  const stats = new StatsStore();
  let first = true;
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async () => {
        if (first) {
          first = false;
          return succeeded('rework');
        }
        return succeeded('ready');
      },
    },
    { policy, stats, random: () => 0 },
  );

  const instance = new FlowRunner({ definition: flow([gateNode()]), goal: { id: 'g' }, executor });
  const result = await instance.execute();

  // Human disagreed on the first (only) run: their verdict wins.
  assert.equal(result.label, 'rework');
});

test('matches annotation-based policy rules', async () => {
  const policies = new PolicyStore();
  policies.put(
    makePolicy('p', '1', {
      qualityBar: 0.5,
      rules: [
        {
          when: { risk: 'structural' },
          config: { bar: { agent: 0.99 } },
        },
      ],
    }),
  );
  const humanRuns: string[] = [];
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async (_tier, context) => {
        humanRuns.push(context.nodeId);
        return succeeded('ready');
      },
    },
    {
      resolvePolicy: (flow) => policies.get(flow.id, flow.version),
      stats: new StatsStore(),
    },
  );

  const instance = new FlowRunner({
    definition: flow([gateNode(undefined, { risk: 'structural' })]),
    goal: { id: 'g' },
    executor,
  });
  await instance.execute();

  // 0.95 < 0.99 (structural rule) → the agent escalates to the human anchor.
  assert.deepEqual(humanRuns, ['gate']);
});

test('routes on the escalated error when no tier meets the bar', async () => {
  const policy = makePolicy('p', '1', { qualityBar: 0.9 });
  const executor = executorWith(
    {
      agent: async () => failed({ code: 'agent.unsure', message: 'not sure' }),
      human: async () => failed({ code: 'human.rejected', message: 'no' }),
    },
    { policy },
  );

  const instance = new FlowRunner({ definition: flow([gateNode()]), goal: { id: 'g' }, executor });
  const result = await instance.execute();

  assert.equal(result.outcome.status, 'failed');
  assert.equal(result.error?.code, 'human.rejected');
});

test('records coverage reported by script tiers', async () => {
  const stats = new StatsStore();
  const executor = executorWith(
    {
      script: async () => ({ ...succeeded('checked'), coverage: 0.75 }),
    },
    { stats },
  );

  const instance = new FlowRunner({
    definition: flow([{ id: 'check', tiers: [{ kind: 'script', run: 'check' }] }]),
    goal: { id: 'g' },
    executor,
  });
  await instance.execute();

  const entry = stats.snapshot().entries.find((candidate) => candidate.key === 'node:flow@1:check');
  assert.ok(entry);
  assert.equal(entry.coverage.sum, 0.75);
  assert.equal(entry.coverage.count, 1);
});

test('aggregates stats per annotation class across nodes', async () => {
  const stats = new StatsStore();
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.95 }),
      human: async () => succeeded('ready'),
    },
    { stats },
  );

  const definition = flow([
    { ...gateNode(undefined, { domain: 'coding' }), id: 'gate-a' },
    { ...gateNode(undefined, { domain: 'coding' }), id: 'gate-b' },
  ]);
  // gate-a and gate-b are unconnected entries: both run.
  const instance = new FlowRunner({ definition, goal: { id: 'g' }, executor });
  await instance.execute();

  const classEntry = stats
    .snapshot()
    .entries.find((candidate) => candidate.key === 'class:domain=coding');
  assert.ok(classEntry);
  assert.equal(classEntry.runs, 2);
  assert.equal(classEntry.agreement['agent-human']?.total, 2);
});

test('run traces persist their sampled and escalation flags', async () => {
  const policy = makePolicy('p', '1', { qualityBar: 0.9 });
  const executor = executorWith(
    {
      agent: async () => ({ ...succeeded('ready'), confidence: 0.5 }),
      human: async () => succeeded('ready'),
    },
    { policy },
  );

  const instance = new FlowRunner({ definition: flow([gateNode()]), goal: { id: 'g' }, executor });
  await instance.execute();

  const tiers = instance.steps[0].tiers as TierRun[];
  assert.equal(tiers[0].escalated, true);
  assert.equal(tiers[0].confidence, 0.5);
  assert.equal(tiers[1].kind, 'human');
});
