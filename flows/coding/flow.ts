import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlowDefinition } from '../../src/model.js';

const here = dirname(fileURLToPath(import.meta.url));

function read(...parts: string[]): string {
  return readFileSync(join(here, ...parts), 'utf8').trim();
}

export const codingFlow: FlowDefinition = {
  id: 'coding',
  version: '1',
  stages: [
    {
      id: 'frame',
      name: 'Frame',
      nodes: [
        {
          id: 'define-spec',
          type: 'agent',
          instruction: read('frame', 'define-spec', 'instruction.md'),
          next: 'confirm-spec',
        },
        {
          id: 'confirm-spec',
          type: 'human',
          assignee: 'Alice',
          prompt: read('frame', 'confirm-spec', 'prompt.md'),
          next: { ready: 'create-ticket', rework: 'define-spec' },
        },
        {
          id: 'create-ticket',
          type: 'script',
          run: 'node flows/coding/frame/create-ticket/create-ticket.mjs',
          next: 'prepare-branch',
        },
      ],
    },
    {
      id: 'make',
      name: 'Make',
      nodes: [
        {
          id: 'prepare-branch',
          type: 'script',
          run: 'node flows/coding/make/prepare-branch/prepare-branch.mjs',
          next: 'implement',
        },
        {
          id: 'implement',
          type: 'agent',
          instruction: read('make', 'implement', 'instruction.md'),
          next: 'verify',
        },
      ],
    },
    {
      id: 'verify',
      name: 'Verify',
      nodes: [
        {
          id: 'verify',
          type: 'script',
          run: 'bash flows/coding/verify/verify/verify.sh',
          next: 'confirm-verify',
        },
        {
          id: 'confirm-verify',
          type: 'human',
          assignee: 'Marcus',
          prompt: read('verify', 'confirm-verify', 'prompt.md'),
          next: { ready: 'commit-and-pr', rework: 'implement' },
        },
      ],
    },
    {
      id: 'deliver',
      name: 'Deliver',
      nodes: [
        {
          id: 'commit-and-pr',
          type: 'script',
          run: 'node flows/coding/deliver/commit-and-pr/commit-and-pr.mjs',
          next: 'pr-review',
        },
        {
          id: 'pr-review',
          type: 'human',
          assignee: 'Alice',
          prompt: read('deliver', 'pr-review', 'prompt.md'),
          next: { approved: 'merge', rework: 'implement' },
        },
      ],
    },
    {
      id: 'land',
      name: 'Land',
      nodes: [
        {
          id: 'merge',
          type: 'script',
          run: 'gh pr merge --squash',
        },
      ],
    },
  ],
};
