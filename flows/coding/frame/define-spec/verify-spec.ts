import { readFileSync } from 'node:fs';
import { taskSpecSchema } from './task-spec.schema.js';

// Verifies a JSON document against the TaskSpec schema. Reads a file path argument or
// stdin. Exits 0 when the document is a valid TaskSpec, 1 otherwise.
//
// Usage:
//   npx tsx verify-spec.ts < task-spec.json
//   npx tsx verify-spec.ts task-spec.json

const arg = process.argv[2];
const input = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');

let value: unknown;
try {
  value = JSON.parse(input);
} catch (error) {
  console.error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = taskSpecSchema.safeParse(value);

if (!result.success) {
  console.error('TaskSpec validation failed:');
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    console.error(`  ${path}: ${issue.message}`);
  }
  process.exit(1);
}

console.log('TaskSpec valid');
