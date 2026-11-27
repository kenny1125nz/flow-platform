import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidationError, validateFlowDefinition, validatePlanDefinition } from '../src/index.js';
import type { FlowDefinition, FlowNode, PlanDefinition } from '../src/index.js';

function script(id: string, next?: FlowNode['next']): FlowNode {
  return { id, tiers: [{ kind: 'script', run: 'echo a' }], ...(next === undefined ? {} : { next }) };
}

function flow(nodes: FlowDefinition['stages'][number]['nodes'], id = 'flow'): FlowDefinition {
  return {
    id,
    version: '1',
    stages: [{ id: 'main', nodes }],
  };
}

function plan(nodes: PlanDefinition['nodes']): PlanDefinition {
  return { id: 'plan', version: '1', nodes };
}

test('rejects duplicate flow node ids', () => {
  assert.throws(
    () => validateFlowDefinition(flow([script('a'), script('a')])),
    GraphValidationError,
  );
});

test('rejects missing next targets', () => {
  assert.throws(
    () => validateFlowDefinition(flow([script('a', 'missing')])),
    GraphValidationError,
  );
});

test('rejects a node without tiers', () => {
  assert.throws(
    () => validateFlowDefinition(flow([{ id: 'a', tiers: [] }])),
    GraphValidationError,
  );
});

test('rejects duplicate tier kinds on a node', () => {
  assert.throws(
    () =>
      validateFlowDefinition(
        flow([
          {
            id: 'a',
            tiers: [
              { kind: 'script', run: 'echo a' },
              { kind: 'script', run: 'echo b' },
            ],
          },
        ]),
      ),
    GraphValidationError,
  );
});

test('rejects bare next on a node with declared errors', () => {
  assert.throws(
    () =>
      validateFlowDefinition(
        flow([
          {
            ...script('a', 'b'),
            errors: [{ code: 'boom' }],
          },
          script('b'),
        ]),
      ),
    GraphValidationError,
  );
});

test('allows rework cycles', () => {
  assert.doesNotThrow(() => validateFlowDefinition(flow([script('a', 'b'), script('b', 'a')])));
});

test('allows joint-effort tier stacks', () => {
  assert.doesNotThrow(() =>
    validateFlowDefinition(
      flow([
        script('a', 'gate'),
        {
          id: 'gate',
          tiers: [{ kind: 'agent', instruction: 'review' }, { kind: 'human', prompt: 'confirm?' }],
          annotations: { risk: 'structural' },
          next: { ready: 'b', rework: 'a' },
        },
        script('b'),
      ]),
    ),
  );
});

test('rejects duplicate plan node ids and missing targets', () => {
  const goal = { id: 'g' };
  const ref = { id: 'f', version: '1' };
  assert.throws(
    () =>
      validatePlanDefinition(
        plan([
          { id: 'a', goal, flow: ref, next: 'b' },
          { id: 'b', goal, flow: ref },
          { id: 'b', goal, flow: ref },
        ]),
      ),
    GraphValidationError,
  );
});
