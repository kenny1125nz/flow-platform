import type { FlowDefinition, FlowNode, NodeRun, OutcomeStatus, StepType, TokenUsage, UnitStatus } from '@shared/model';
import type { FlowRunDetail } from '@shared/api-types';

export function displayStatus(run: NodeRun): UnitStatus | OutcomeStatus {
  return run.status === 'ended' && run.outcome ? run.outcome.status : run.status;
}

export function summaryOf(node: FlowNode): string {
  switch (node.type) {
    case 'human':
      return node.prompt ?? (node.assignee ? `Assigned to ${node.assignee}` : 'Waiting for a person');
    case 'agent':
      return node.instruction;
    case 'script':
      return node.run;
  }
}

export function timingOf(run: NodeRun, now: number): string {
  if (!run.startedAt) {
    return '';
  }
  const startedAt = new Date(run.startedAt).getTime();
  const endedAt = run.finishedAt ? new Date(run.finishedAt).getTime() : now;
  return formatDuration(Math.max(0, endedAt - startedAt));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatTokens(usage?: TokenUsage): string {
  if (!usage) {
    return '';
  }
  const total = usage.input + usage.output;
  return formatCount(total);
}

export function tokenBreakdown(usage?: TokenUsage): string {
  if (!usage) {
    return '';
  }
  const cost = usage.cost === undefined ? '' : ` · $${usage.cost.toFixed(4)}`;
  return `input ${formatCount(usage.input)} · output ${formatCount(usage.output)}` +
    `${usage.reasoning ? ` · reasoning ${formatCount(usage.reasoning)}` : ''}` +
    `${usage.cacheRead ? ` · cache ${formatCount(usage.cacheRead)}` : ''}${cost}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

export type FlowCardBase = {
  node: FlowNode;
  stage: string;
};

export function collectFlowCards(definition: FlowDefinition): FlowCardBase[] {
  const cards: FlowCardBase[] = [];
  const walk = (stages: FlowDefinition['stages'], prefix: string): void => {
    for (const stage of stages) {
      const name = prefix ? `${prefix} / ${stage.name ?? stage.id}` : (stage.name ?? stage.id);
      for (const node of stage.nodes) {
        cards.push({ node, stage: name });
      }
      if (stage.substages) {
        walk(stage.substages, name);
      }
    }
  };
  walk(definition.stages, '');
  return cards;
}

export type RunColumn = 'human' | 'agent' | 'script' | 'paused' | 'ended';

const runningPriority: StepType[] = ['human', 'agent', 'script'];

export function focusStep(run: FlowRunDetail): NodeRun | undefined {
  const running = run.steps.filter((step) => step.status === 'running');
  if (running.length > 0) {
    return [...running].sort(
      (a, b) => runningPriority.indexOf(a.type) - runningPriority.indexOf(b.type),
    )[0];
  }
  if (run.status === 'paused') {
    const paused = [...run.steps].reverse().find((step) => step.status === 'paused');
    return paused ?? run.steps.at(-1);
  }
  return run.steps.at(-1);
}

export function runColumn(run: FlowRunDetail): RunColumn {
  if (run.status === 'paused') {
    return 'paused';
  }
  if (run.status === 'ended') {
    return 'ended';
  }
  const running = run.steps.filter((step) => step.status === 'running');
  if (running.some((step) => step.type === 'human')) {
    return 'human';
  }
  if (running.some((step) => step.type === 'agent')) {
    return 'agent';
  }
  if (running.some((step) => step.type === 'script')) {
    return 'script';
  }
  return 'paused';
}

export function flowDisplayStatus(run: FlowRunDetail): UnitStatus | OutcomeStatus {
  return run.status === 'ended' && run.result ? run.result.outcome.status : run.status;
}
