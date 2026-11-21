#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Reads a GitHub issue back into a TaskSpec. The issue body embeds the spec as a fenced
// JSON block (see create-ticket.mjs). Prints the spec, so the Make stage can implement
// against it.
//
// Usage:
//   node read-ticket.mjs <issue-number>

const number = process.argv[2];
if (!number) {
  process.stderr.write('usage: read-ticket.mjs <issue-number>\n');
  process.exit(1);
}

let issue;
try {
  const raw = execFileSync('gh', ['issue', 'view', number, '--json', 'number,title,body'], {
    encoding: 'utf8',
  });
  issue = JSON.parse(raw);
} catch (error) {
  process.stderr.write(`gh issue view failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const spec = extractSpec(issue.body);
if (!spec) {
  process.stderr.write('no task spec found in issue body\n');
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ outcome: 'succeeded', output: { issue: { number: issue.number, title: issue.title }, spec } })}\n`,
);

function extractSpec(body) {
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}
