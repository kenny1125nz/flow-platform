import { readFileSync } from 'node:fs';
import { implementationReportSchema } from './implementation-report.schema.js';

// Verifies a JSON document against the ImplementationReport schema. Reads a file path
// argument or stdin. Exits 0 when valid, 1 otherwise.
//
// Usage:
//   npx tsx verify-report.ts < implementation-report.json
//   npx tsx verify-report.ts implementation-report.json

const arg = process.argv[2];
const input = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');

let value: unknown;
try {
  value = JSON.parse(input);
} catch (error) {
  console.error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = implementationReportSchema.safeParse(value);

if (!result.success) {
  console.error('ImplementationReport validation failed:');
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    console.error(`  ${path}: ${issue.message}`);
  }
  process.exit(1);
}

console.log('ImplementationReport valid');
