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
          next: 'implement',
        },
      ],
    },
    {
      id: 'make',
      name: 'Make',
      nodes: [
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
          next: { ready: 'pr-review', rework: 'implement' },
        },
      ],
    },
    {
      id: 'second-option',
      name: 'Second Option',
      nodes: [
        {
          id: 'pr-review',
          type: 'script',
          run: 'bash flows/coding/second-option/pr-review/pr-review.sh',
          next: { ready: 'merge', rework: 'implement' },
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
          run: 'git status --short',
        },
      ],
    },
  ],
};
