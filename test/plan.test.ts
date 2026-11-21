import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlanRunner,
  createFlowResolver,
  createNodeExecutor,
  failed,
  succeeded,
} from '../src/index.js';
import type { FlowDefinition, NodeContext, PlanDefinition } from '../src/index.js';

function oneNodeFlow(id: string, nodeId: string): FlowDefinition {
  return {
    id,
    version: '1',
    stages: [{ id: 'main', nodes: [{ id: nodeId, type: 'script', run: `echo ${nodeId}` }] }],
  };
}

function plan(nodes: PlanDefinition['nodes']): PlanDefinition {
  return { id: 'plan', version: '1', nodes };
}

test('runs plan nodes in order and consumes each flow result', async () => {
  const order: string[] = [];
  const executor = createNodeExecutor({
    script: async (node, context: NodeContext) => {
      order.push(`${context.goal.id}:${node.id}`);
      return node.id === 'x' ? succeeded('done') : succeeded('finished');
    },
  });

  const definition = plan([
    {
      id: 'a',
      goal: { id: 'ga' },
      flow: { id: 'f1', version: '1' },
      next: { done: 'b' },
    },
    { id: 'b', goal: { id: 'gb' }, flow: { id: 'f2', version: '1' } },
  ]);

  const instance = new PlanRunner({
    definition,
    resolveFlow: createFlowResolver([oneNodeFlow('f1', 'x'), oneNodeFlow('f2', 'y')]),
    executor,
  });

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'finished');
  assert.deepEqual(order, ['ga:x', 'gb:y']);
  assert.equal(instance.steps.length, 2);
  assert.equal(instance.getFlowInstance('a')?.status, 'ended');
  assert.equal(instance.getFlowInstance('b')?.status, 'ended');
});

test('runs plan branches in parallel', { timeout: 2000 }, async () => {
  let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const executor = createNodeExecutor({
    script: async (node) => {
      if (node.id === 'y' || node.id === 'z') {
        started += 1;
        if (started === 2) {
          release();
        }
        await barrier;
      }
      return succeeded(node.id);
    },
  });

  const definition = plan([
    {
      id: 'a',
      goal: { id: 'ga' },
      flow: { id: 'fa', version: '1' },
      next: ['b', 'c'],
    },
    { id: 'b', goal: { id: 'gb' }, flow: { id: 'fb', version: '1' } },
    { id: 'c', goal: { id: 'gc' }, flow: { id: 'fc', version: '1' } },
  ]);

  const instance = new PlanRunner({
    definition,
    resolveFlow: createFlowResolver([
      oneNodeFlow('fa', 'x'),
      oneNodeFlow('fb', 'y'),
      oneNodeFlow('fc', 'z'),
    ]),
    executor,
  });

  const result = await instance.execute();

  assert.equal(result.outcome.status, 'succeeded');
  assert.deepEqual(instance.steps.map((step) => step.nodeId).sort(), ['a', 'b', 'c']);
});

test('routes a plan on the flow error code', async () => {
  const visited: string[] = [];
  const executor = createNodeExecutor({
    script: async (node, context) => {
      visited.push(`${context.goal.id}:${node.id}`);
      if (node.id === 'x') {
        return failed({ code: 'bad' });
      }
      return succeeded('recovered');
    },
  });

  const definition = plan([
    {
      id: 'a',
      goal: { id: 'ga' },
      flow: { id: 'f1', version: '1' },
      errors: [{ code: 'bad' }],
      next: { bad: 'b' },
    },
    { id: 'b', goal: { id: 'gb' }, flow: { id: 'f2', version: '1' } },
  ]);

  const instance = new PlanRunner({
    definition,
    resolveFlow: createFlowResolver([oneNodeFlow('f1', 'x'), oneNodeFlow('f2', 'y')]),
    executor,
  });

  const result = await instance.execute();

  assert.equal(instance.status, 'ended');
  assert.equal(result.label, 'recovered');
  assert.deepEqual(visited, ['ga:x', 'gb:y']);
});
