import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowDefinition } from '../model.js';
import { makePolicy, PolicyStore, type FlowPolicy } from '../policy.js';
import { flowsRoot } from './paths.js';
import type { DefinitionStore } from './store.js';

export function seedDefinitions(store: DefinitionStore): void {
  store.putFlow(loadCodingFlow());
}

export function seedPolicies(store: PolicyStore): void {
  const path = join(flowsRoot(), 'coding', 'policy.json');
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<FlowPolicy> & { id: string; version: string };
    store.put(makePolicy(raw.id, raw.version, raw));
  }
}

function loadCodingFlow(): FlowDefinition {
  const path = join(flowsRoot(), 'coding', 'definition.json');
  if (!existsSync(path)) {
    throw new Error(`coding flow distribution not found at ${path}. Run "npm run build:definitions".`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as FlowDefinition;
}
