import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codingFlow } from '../flows/coding/flow.js';
import { validateFlowDefinition } from '../src/graph.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

validateFlowDefinition(codingFlow);

const outFile = join(root, 'flows', 'coding', 'definition.json');
writeFileSync(outFile, `${JSON.stringify(codingFlow, null, 2)}\n`);

console.log(`built ${codingFlow.id}@${codingFlow.version} -> ${outFile}`);
