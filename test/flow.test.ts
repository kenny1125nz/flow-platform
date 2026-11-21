import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FlowRunner,
  HumanTaskBroker,
  createNodeExecutor,
  failed,
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
  return { id, type: 'script', run: `echo ${id}`, ...(next === undefined ? {} : { next }) };
}

function runner(definition: FlowDefinition, executor: ReturnType<typeof createNodeExecutor>): FlowRunner {
  return new FlowRunner({ definition, goal: { id: 'goal' }, executor });
}

test('runs a linear flow and returns the terminal result', async () => {
  const order: string[] = [];
  const executor = createNodeExecutor({
    script: async (node) => {
      order.push(node.id);
      return succeeded('script-done');
    },
    agent: async (node) => {
      order.push(node.id);
      return succeeded('agent-done');
    },
    human: async (node) => {
      order.push(node.id);
      return succeeded('human-done');
    },
  });

  const instance = runner(
    flow([
      script('a', 'b'),
      { id: 'b', type: 'agent', instruction: 'do it', next: 'c' },
      { id: 'c', type: 'human', prompt: 'approve' },
    ]),
    executor,
  );

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.outcome.status, 'succeeded');
  assert.equal(result.label, 'human-done');
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(instance.steps.map((step) => step.nodeId), ['a', 'b', 'c']);
});

test('routes on positive outcome labels', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (node) => {
      visited.push(node.id);
      return node.id === 'decision' ? succeeded('approved') : succeeded(node.id);
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
    script: async (node) => {
      visited.push(node.id);
      if (node.id === 'build') {
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

test('runs parallel fan-out', { timeout: 2000 }, async () => {
  let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const executor = createNodeExecutor({
    script: async (node) => {
      if (node.id === 'left' || node.id === 'right') {
        started += 1;
        if (started === 2) {
          release();
        }
        await barrier;
      }
      return succeeded(node.id);
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
    script: async (node) => succeeded(node.id),
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
        type: 'human',
        prompt: 'Approve?',
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
  const instance = runner(flow([{ id: 'approve', type: 'human', prompt: 'ok?' }]), executor);

  const pending = instance.execute();
  await waitFor(() => broker.pending().length === 1);

  const key = broker.pending()[0];
  assert.equal(broker.respondByKey(key, succeeded('approved')), true);

  const result = await pending;
  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'approved');
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
