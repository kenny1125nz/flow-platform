import type { FlowDefinition, PlanDefinition } from '../model.js';
import type { DefinitionStore } from './store.js';

export function seedDefinitions(store: DefinitionStore): void {
  store.putFlow(releaseFlow);
  store.putFlow(agentReviewFlow);
  store.putFlow(codingFlow);
  store.putPlan(releasePlan);
}

const releaseFlow: FlowDefinition = {
  id: 'release',
  version: '1',
  stages: [
    {
      id: 'prepare',
      name: 'Prepare',
      nodes: [
        {
          id: 'prepare',
          type: 'script',
          run: 'echo "preparing release"',
          next: 'approve',
        },
      ],
    },
    {
      id: 'approval',
      name: 'Approval',
      nodes: [
        {
          id: 'approve',
          type: 'human',
          assignee: 'release-manager',
          prompt: 'Approve this release?',
          next: { approved: 'deploy', rejected: 'cancel' },
        },
      ],
    },
    {
      id: 'release',
      name: 'Release',
      nodes: [
        { id: 'deploy', type: 'script', run: 'echo "deploying"' },
        { id: 'cancel', type: 'script', run: 'echo "release cancelled"' },
      ],
    },
  ],
};

const agentReviewFlow: FlowDefinition = {
  id: 'agent-review',
  version: '1',
  stages: [
    {
      id: 'review',
      name: 'Review',
      nodes: [
        {
          id: 'review',
          type: 'agent',
          instruction: 'Review the release plan and summarize the main risks in two sentences.',
          next: 'done',
        },
      ],
    },
    {
      id: 'done',
      name: 'Done',
      nodes: [{ id: 'done', type: 'script', run: 'echo "review complete"' }],
    },
  ],
};

const releasePlan: PlanDefinition = {
  id: 'release-plan',
  version: '1',
  nodes: [
    {
      id: 'review',
      goal: { id: 'release-1', description: 'Review the release risks' },
      flow: { id: 'agent-review', version: '1' },
      next: 'release',
    },
    {
      id: 'release',
      goal: { id: 'release-1', description: 'Ship the release' },
      flow: { id: 'release', version: '1' },
    },
  ],
};

const codingFlow: FlowDefinition = {
  id: 'coding',
  version: '1',
  stages: [
    {
      id: 'frame',
      name: 'Frame',
      nodes: [
        {
          id: 'understand',
          type: 'agent',
          instruction:
            'Read the goal and repository context. Produce a concise implementation brief with acceptance criteria, risks, and the files likely to change. Do not modify files.',
          next: 'approve-brief',
        },
        {
          id: 'approve-brief',
          type: 'human',
          assignee: 'tech-lead',
          prompt: 'Approve the implementation brief and acceptance criteria?',
          next: { approved: 'implement', rejected: 'understand' },
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
          instruction:
            'Implement the approved brief. Make the smallest coherent change and run the build and tests as you go to verify your work.',
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
          run: 'npm run build && npm test',
          next: 'decide',
        },
        {
          id: 'decide',
          type: 'human',
          assignee: 'tech-lead',
          prompt: 'Review the build and test results. Is this change ready for PR review, or does it need rework?',
          next: { accept: 'pr-review', rework: 'implement' },
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
          run: 'bash scripts/pr-review.sh',
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
          run: 'git status --short',
        },
      ],
    },
  ],
};
