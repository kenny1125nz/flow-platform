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
          tiers: [{ kind: 'agent', instruction: read('frame', 'define-spec', 'instruction.md') }],
          next: 'confirm-spec',
        },
        {
          id: 'confirm-spec',
          tiers: [
            { kind: 'agent', instruction: read('frame', 'confirm-spec', 'instruction.md') },
            {
              kind: 'human',
              assignee: 'Alice',
              prompt: read('frame', 'confirm-spec', 'prompt.md'),
            },
          ],
          annotations: { risk: 'structural', domain: 'spec' },
          next: { ready: 'create-ticket', rework: 'define-spec' },
        },
        {
          id: 'create-ticket',
          tiers: [{ kind: 'script', run: 'node flows/coding/frame/create-ticket/create-ticket.mjs' }],
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
          tiers: [{ kind: 'script', run: 'node flows/coding/make/prepare-branch/prepare-branch.mjs' }],
          next: 'implement',
        },
        {
          id: 'implement',
          tiers: [{ kind: 'agent', instruction: read('make', 'implement', 'instruction.md') }],
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
          tiers: [{ kind: 'script', run: 'bash flows/coding/verify/verify/verify.sh' }],
          next: 'confirm-verify',
        },
        {
          id: 'confirm-verify',
          tiers: [
            { kind: 'agent', instruction: read('verify', 'confirm-verify', 'instruction.md') },
            {
              kind: 'human',
              assignee: 'Marcus',
              prompt: read('verify', 'confirm-verify', 'prompt.md'),
            },
          ],
          annotations: { domain: 'coding' },
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
          tiers: [{ kind: 'script', run: 'node flows/coding/deliver/commit-and-pr/commit-and-pr.mjs' }],
          next: 'pr-review',
        },
        {
          id: 'pr-review',
          tiers: [
            { kind: 'agent', instruction: read('deliver', 'pr-review', 'instruction.md') },
            {
              kind: 'human',
              assignee: 'Alice',
              prompt: read('deliver', 'pr-review', 'prompt.md'),
            },
          ],
          annotations: { risk: 'structural', domain: 'coding' },
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
          tiers: [{ kind: 'script', run: 'gh pr merge --squash' }],
        },
      ],
    },
  ],
};
