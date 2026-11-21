#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Publishes the confirmed task spec to a GitHub issue and returns a stable reference
// (issue number + url) that the Make stage reads back. The spec is read from the
// upstream define-spec output (FLOW_OUTPUTS) and embedded in the issue body as a
// fenced JSON block so it round-trips losslessly.

const outputs = JSON.parse(process.env.FLOW_OUTPUTS ?? '{}');
const spec = outputs['define-spec'];

if (!spec) {
  process.stderr.write('no define-spec output found in FLOW_OUTPUTS\n');
  process.exit(1);
}

const title = spec.goal?.statement ?? 'Untitled task';
const body = renderBody(spec);

let url;
try {
  const stdout = execFileSync('gh', ['issue', 'create', '--title', title, '--body', body], {
    encoding: 'utf8',
  });
  url = stdout.trim().split('\n').pop()?.trim();
} catch (error) {
  process.stderr.write(`gh issue create failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

if (!url) {
  process.stderr.write('gh issue create returned no url\n');
  process.exit(1);
}

const number = Number(url.split('/').pop());

process.stdout.write(
  `${JSON.stringify({ outcome: 'succeeded', output: { issue: { number, url, title } } })}\n`,
);

function renderBody(spec) {
  const lines = [];
  lines.push(spec.goal?.statement ?? '');

  if (spec.goal?.nonGoals?.length) {
    lines.push('', '## Non-goals');
    for (const nonGoal of spec.goal.nonGoals) lines.push(`- ${nonGoal}`);
  }

  if (spec.constraints?.length) {
    lines.push('', '## Constraints');
    for (const constraint of spec.constraints) lines.push(`- ${constraint}`);
  }

  if (spec.scope?.files?.length) {
    lines.push('', '## Scope', `- files: ${spec.scope.files.join(', ')}`);
  }
  if (spec.scope?.mustNotChange?.length) {
    lines.push(`- must not change: ${spec.scope.mustNotChange.join(', ')}`);
  }

  if (spec.acceptanceCriteria?.length) {
    lines.push('', '## Acceptance criteria');
    for (const criterion of spec.acceptanceCriteria) {
      lines.push(`- [${criterion.id}] ${criterion.statement} (verify: ${criterion.verifyWith})`);
    }
  }

  if (spec.evaluation?.commands?.length) {
    lines.push('', '## Evaluation');
    for (const command of spec.evaluation.commands) lines.push(`- ${command}`);
  }

  lines.push('', '```json', JSON.stringify(spec, null, 2), '```');
  return lines.join('\n');
}
