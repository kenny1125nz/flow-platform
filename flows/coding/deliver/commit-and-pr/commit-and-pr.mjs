#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Commits the change, pushes the branch, and opens (or reuses) a pull request. The
// task spec goal is used as the commit/PR title; the PR body links the tracker issue.

const outputs = JSON.parse(process.env.FLOW_OUTPUTS ?? '{}');
const goal = outputs['define-spec']?.goal?.statement ?? 'flow change';
const issue = outputs['create-ticket']?.issue;

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { encoding: 'utf8' });
    return { ok: true, stdout: stdout.toString(), stderr: '' };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout ? String(error.stdout) : '',
      stderr: error.stderr ? String(error.stderr) : String(error.message),
    };
  }
}

function fail(step, message) {
  process.stderr.write(`${step} failed: ${message}\n`);
  process.exit(1);
}

const add = run('git', ['add', '-A']);
if (!add.ok) fail('git add', add.stderr);

const commit = run('git', ['commit', '-m', goal]);
if (!commit.ok && !/nothing to commit|nothing added/i.test(`${commit.stderr}${commit.stdout}`)) {
  fail('git commit', commit.stderr);
}

let push = run('git', ['push']);
if (!push.ok) {
  push = run('git', ['push', '--set-upstream', 'origin', 'HEAD']);
  if (!push.ok) fail('git push', push.stderr);
}

let pr;
const body = issue ? `Closes #${issue.number}` : goal;
const create = run('gh', ['pr', 'create', '--title', goal, '--body', body]);
if (create.ok) {
  const url = create.stdout.trim().split('\n').pop()?.trim();
  pr = { number: Number(url.split('/').pop()), url };
} else {
  const view = run('gh', ['pr', 'view', '--json', 'number,url']);
  if (!view.ok) fail('gh pr create', create.stderr);
  pr = JSON.parse(view.stdout);
}

process.stdout.write(`${JSON.stringify({ outcome: 'succeeded', output: { pr } })}\n`);
