#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

// Creates (or reuses) a feature branch so the implementation never happens on `main`.
// The branch name derives from the tracker issue created in Frame, so the PR later
// targets main with a real diff.

const outputs = JSON.parse(process.env.FLOW_OUTPUTS ?? '{}');
const issueNumber = outputs['create-ticket']?.issue?.number;
const branch = issueNumber ? `flow/issue-${issueNumber}` : `flow/change-${Date.now()}`;

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

run('git', ['fetch', 'origin', 'main']);

// Base the feature branch on the latest main, creating it if needed.
let checkout = run('git', ['checkout', '-B', branch, 'origin/main']);
if (!checkout.ok) {
  checkout = run('git', ['checkout', '-B', branch, 'main']);
  if (!checkout.ok) {
    process.stderr.write(`git checkout ${branch} failed: ${checkout.stderr}\n`);
    process.exit(1);
  }
}

process.stdout.write(`${JSON.stringify({ outcome: 'succeeded', output: { branch } })}\n`);
