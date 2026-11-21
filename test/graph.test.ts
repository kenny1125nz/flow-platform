import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphValidationError, validateFlowDefinition, validatePlanDefinition } from '../src/index.js';
import type { FlowDefinition, PlanDefinition } from '../src/index.js';

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
    () =>
      validateFlowDefinition(
        flow([
          { id: 'a', type: 'script', run: 'echo a' },
          { id: 'a', type: 'script', run: 'echo b' },
        ]),
      ),
    GraphValidationError,
  );
});

test('rejects missing next targets', () => {
  assert.throws(
    () => validateFlowDefinition(flow([{ id: 'a', type: 'script', run: 'echo a', next: 'missing' }])),
    GraphValidationError,
  );
});

test('rejects bare next on a node with declared errors', () => {
  assert.throws(
    () =>
      validateFlowDefinition(
        flow([
          {
            id: 'a',
            type: 'script',
            run: 'echo a',
            errors: [{ code: 'boom' }],
            next: 'b',
          },
          { id: 'b', type: 'script', run: 'echo b' },
        ]),
      ),
    GraphValidationError,
  );
});

test('allows rework cycles', () => {
  assert.doesNotThrow(() =>
    validateFlowDefinition(
      flow([
        { id: 'a', type: 'script', run: 'echo a', next: 'b' },
        { id: 'b', type: 'script', run: 'echo b', next: 'a' },
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
