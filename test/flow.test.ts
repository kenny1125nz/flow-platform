import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FlowRunner,
  HumanTaskBroker,
  createNodeExecutor,
  failed,
  localScriptHandler,
  succeeded,
} from '../src/index.js';
import type { FlowDefinition, FlowNode } from '../src/index.js';

function flow(nodes: FlowNode[]): FlowDefinition {
  return {
    id: 'flow',
    version: '1',
    stages: [{ id: 'main', nodes }],
  };
}

function script(id: string, next?: FlowNode['next']): FlowNode {
  return { id, tiers: [{ kind: 'script', run: `echo ${id}` }], ...(next === undefined ? {} : { next }) };
}

function agent(id: string, instruction = 'do it', next?: FlowNode['next']): FlowNode {
  return { id, tiers: [{ kind: 'agent', instruction }], ...(next === undefined ? {} : { next }) };
}

function human(id: string, next?: FlowNode['next']): FlowNode {
  return { id, tiers: [{ kind: 'human', prompt: 'approve' }], ...(next === undefined ? {} : { next }) };
}

function runner(definition: FlowDefinition, executor: ReturnType<typeof createNodeExecutor>): FlowRunner {
  return new FlowRunner({ definition, goal: { id: 'goal' }, executor });
}

test('runs a linear flow and returns the terminal result', async () => {
  const order: string[] = [];
  const executor = createNodeExecutor({
    script: async (tier, context) => {
      order.push(context.nodeId);
      return succeeded('script-done');
    },
    agent: async (_tier, context) => {
      order.push(context.nodeId);
      return succeeded('agent-done');
    },
    human: async (_tier, context) => {
      order.push(context.nodeId);
      return succeeded('human-done');
    },
  });

  const instance = runner(flow([script('a', 'b'), agent('b', 'do it', 'c'), human('c')]), executor);

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.outcome.status, 'succeeded');
  assert.equal(result.label, 'human-done');
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a', 'b', 'c']);
  assert.deepEqual(instance.steps.map((step) => step.tiers.map((tier) => tier.kind)), [
    ['script'],
    ['agent'],
    ['human'],
  ]);
});

test('routes on positive outcome labels', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      visited.push(context.nodeId);
      return context.nodeId === 'decision' ? succeeded('approved') : succeeded(context.nodeId);
    },
  });

  const instance = runner(
    flow([
      script('decision', { approved: 'deploy', rejected: 'notify' }),
      script('deploy'),
      script('notify'),
    ]),
    executor,
  );

  const result = await instance.execute();

  assert.equal(result.label, 'deploy');
  assert.deepEqual(visited, ['decision', 'deploy']);
});

test('routes on error codes', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      visited.push(context.nodeId);
      if (context.nodeId === 'build') {
        return failed({ code: 'build.broken', message: 'compile failed' });
      }
      return succeeded('recovered');
    },
  });

  const instance = runner(
    flow([
      {
        ...script('build', { 'build.broken': 'recover' }),
        errors: [{ code: 'build.broken' }],
      },
      script('recover'),
    ]),
    executor,
  );

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'recovered');
  assert.deepEqual(visited, ['build', 'recover']);
});

test('pauses on an unrouted error', async () => {
  const executor = createNodeExecutor({ script: async () => failed({ code: 'boom', message: 'bad' }) });
  const instance = runner(flow([script('a', 'b'), script('b')]), executor);

  const result = await instance.execute();

  assert.equal(instance.status, 'paused');
  assert.equal(result.outcome.status, 'failed');
  assert.equal(result.error?.code, 'boom');
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a']);
});

test('retries a paused step in place and continues', async () => {
  let attempts = 0;
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      if (context.nodeId === 'a') {
        attempts += 1;
        return attempts === 1 ? failed({ code: 'boom', message: 'bad' }) : succeeded('retried');
      }
      return succeeded(context.nodeId);
    },
  });
  const instance = runner(flow([script('a', 'b'), script('b')]), executor);

  await instance.execute();
  assert.equal(instance.status, 'paused');
  assert.equal(instance.steps.length, 1);

  instance.retryStep('a');
  await waitFor(() => instance.status === 'ended');

  assert.equal(instance.steps.length, 2);
  assert.equal(instance.steps[0].nodeId, 'a');
  assert.equal(instance.steps[0].status, 'ended');
  assert.equal(instance.steps[0].label, 'retried');
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a', 'b']);
  assert.equal(instance.result?.outcome.status, 'succeeded');
});

test('skips a paused step and follows its positive route', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      visited.push(context.nodeId);
      if (context.nodeId === 'a') {
        return failed({ code: 'boom', message: 'bad' });
      }
      return succeeded(context.nodeId);
    },
  });
  const instance = runner(flow([script('a', 'b'), script('b')]), executor);

  await instance.execute();
  assert.equal(instance.status, 'paused');

  instance.skipStep('a');
  await waitFor(() => instance.status === 'ended');

  assert.deepEqual(visited, ['a', 'b']);
  assert.equal(instance.steps[0].label, 'skipped');
  assert.equal(instance.steps[0].outcome?.status, 'cancelled');
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a', 'b']);
});

test('jumps from a paused step to an explicit step', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      visited.push(context.nodeId);
      if (context.nodeId === 'b') {
        return failed({ code: 'boom', message: 'bad' });
      }
      return succeeded(context.nodeId);
    },
  });
  const instance = runner(flow([script('a', 'b'), script('b', 'c'), script('c')]), executor);

  await instance.execute();
  assert.equal(instance.status, 'paused');

  instance.jumpToStep('c');
  await waitFor(() => instance.status === 'ended');

  assert.deepEqual(visited, ['a', 'b', 'c']);
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a', 'b', 'c']);
  assert.equal(instance.result?.outcome.status, 'succeeded');
});

test('rejects operator actions when the run is not paused', async () => {
  const executor = createNodeExecutor({ script: async () => succeeded() });
  const instance = runner(flow([script('a')]), executor);

  assert.throws(() => instance.retryStep('a'), /not paused/);
  assert.throws(() => instance.skipStep('a'), /not paused/);
  assert.throws(() => instance.jumpToStep('a'), /not paused/);
});

test('runs parallel fan-out', { timeout: 2000 }, async () => {
  let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      if (context.nodeId === 'left' || context.nodeId === 'right') {
        started += 1;
        if (started === 2) {
          release();
        }
        await barrier;
      }
      return succeeded(context.nodeId);
    },
  });

  const instance = runner(flow([script('root', ['left', 'right']), script('left'), script('right')]), executor);
  const result = await instance.execute();

  assert.equal(result.outcome.status, 'succeeded');
  assert.deepEqual(instance.steps.map((step) => step.nodeId).sort(), ['left', 'right', 'root']);
});

test('supports rework loops', async () => {
  let reviews = 0;
  const executor = createNodeExecutor({
    script: async (_tier, context) => succeeded(context.nodeId),
    human: async () => {
      reviews += 1;
      return reviews === 1 ? succeeded('rework') : succeeded('approve');
    },
  });

  const instance = runner(
    flow([
      script('start', 'review'),
      {
        id: 'review',
        tiers: [{ kind: 'human', prompt: 'Approve?' }],
        next: { rework: 'start', approve: 'done' },
      },
      script('done'),
    ]),
    executor,
  );

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'done');
  assert.deepEqual(instance.steps.map((step) => step.nodeId), [
    'start',
    'review',
    'start',
    'review',
    'done',
  ]);
  assert.equal(instance.steps.filter((step) => step.nodeId === 'start').length, 2);
});

test('waits for a human response through the broker', async () => {
  const broker = new HumanTaskBroker();
  const executor = createNodeExecutor({ human: broker.handler });
  const instance = runner(flow([human('approve')]), executor);

  const pending = instance.execute();
  await waitFor(() => broker.pending().length === 1);

  const key = broker.pending()[0];
  assert.equal(broker.respondByKey(key, succeeded('approved')), true);

  const result = await pending;
  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'approved');
});

test('carries node outputs to downstream nodes', async () => {
  const received: unknown[] = [];
  const executor = createNodeExecutor({
    agent: async (_tier, context) => {
      if (context.nodeId === 'frame') {
        return { outcome: { status: 'succeeded' }, output: { goal: 'ship it' } };
      }
      received.push(context.outputs);
      return succeeded('done');
    },
  });

  const instance = runner(
    flow([agent('frame', 'frame', 'make'), agent('make', 'make')]),
    executor,
  );

  await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.deepEqual(instance.steps[0].output, { goal: 'ship it' });
  assert.deepEqual(received, [{ frame: { goal: 'ship it' } }]);
});

test('passes work context to node handlers', async () => {
  const received: unknown[] = [];
  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      received.push(context.context);
      return succeeded('done');
    },
  });

  const instance = new FlowRunner({
    definition: flow([script('a')]),
    goal: { id: 'g' },
    context: { repo: 'owner/repo', branch: 'feature', workspace: '/tmp/ws', issueId: '42' },
    executor,
  });

  await instance.execute();

  assert.deepEqual(received, [
    { repo: 'owner/repo', branch: 'feature', workspace: '/tmp/ws', issueId: '42' },
  ]);
});

test('records the live tier trace while a human tier is pending', async () => {
  const broker = new HumanTaskBroker();
  const executor = createNodeExecutor({
    agent: async () => succeeded('agent-done'),
    human: broker.handler,
  });

  const instance = runner(
    flow([
      {
        id: 'gate',
        tiers: [{ kind: 'agent', instruction: 'review' }, { kind: 'human', prompt: 'confirm?' }],
      },
    ]),
    executor,
  );

  const pending = instance.execute();
  await waitFor(() => broker.pending().length === 1);

  const step = instance.steps.find((candidate) => candidate.nodeId === 'gate');
  assert.ok(step);
  assert.equal(step.status, 'running');
  assert.deepEqual(step.tiers.map((tier) => tier.kind), ['agent', 'human']);
  assert.equal(step.tiers[0].status, 'ended');
  assert.equal(step.tiers[1].status, 'running');

  broker.respondByKey(broker.pending()[0], succeeded('approved'));
  const result = await pending;

  assert.equal(result.label, 'approved');
  assert.equal(instance.steps[0].tiers[1].status, 'ended');
});

test('cancels a running flow', async () => {
  const executor = createNodeExecutor({
    script: async () => {
      await new Promise<void>(() => {});
      return succeeded('done');
    },
  });

  const instance = new FlowRunner({
    definition: flow([script('a', 'b'), script('b')]),
    goal: { id: 'g' },
    executor,
  });

  const pending = instance.execute();
  await waitFor(() => instance.steps.length > 0);
  instance.cancel();

  const result = await pending;
  assert.equal(instance.status, 'ended');
  assert.equal(result.outcome.status, 'cancelled');
});

test('pauses and resumes a flow', async () => {
  const order: string[] = [];
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });

  const executor = createNodeExecutor({
    script: async (_tier, context) => {
      order.push(context.nodeId);
      if (context.nodeId === 'a') {
        await gateA;
      }
      return succeeded(context.nodeId);
    },
  });

  const instance = new FlowRunner({
    definition: flow([script('a', 'b'), script('b')]),
    goal: { id: 'g' },
    executor,
  });

  const pending = instance.execute();
  await waitFor(() => order.includes('a'));
  instance.pause();

  releaseA();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(instance.suspended, true);
  assert.deepEqual(order, ['a']);

  instance.resume();
  const result = await pending;
  assert.equal(result.outcome.status, 'succeeded');
  assert.deepEqual(order, ['a', 'b']);
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('captures stdout and stderr from a script executor into the tier trace', async () => {
  const executor = createNodeExecutor({ script: localScriptHandler });
  const definition = flow([
    {
      id: 'run',
      tiers: [
        {
          kind: 'script',
          run: `node -e "process.stdout.write(JSON.stringify({outcome:'succeeded',label:'ok'}));process.stderr.write('warn')"`,
        },
      ],
    },
  ]);

  const instance = new FlowRunner({ definition, goal: { id: 'g' }, executor });
  const result = await instance.execute();

  assert.equal(result.label, 'ok');
  const tier = instance.steps[0].tiers[0];
  assert.match(tier.stdout ?? '', /"label":"ok"/);
  assert.equal(tier.stderr, 'warn');
});
