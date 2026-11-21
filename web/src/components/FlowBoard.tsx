import { useEffect, useState } from 'react';
import type { FlowDefinition, StepType } from '@shared/model';
import type { FlowRunDetail } from '@shared/api-types';
import {
  collectFlowCards,
  flowDisplayStatus,
  focusStep,
  runColumn,
  summaryOf,
  timingOf,
  type RunColumn,
} from './card-utils';
import { StatusBadge } from './StatusBadge';

type CardType = StepType | 'flow';

const columns: { key: RunColumn; label: string }[] = [
  { key: 'human', label: 'Human' },
  { key: 'agent', label: 'Agent' },
  { key: 'script', label: 'Script' },
  { key: 'paused', label: 'Paused / Blocked' },
  { key: 'ended', label: 'Ended' },
];

const typeInitial: Record<CardType, string> = {
  human: 'H',
  agent: 'A',
  script: 'S',
  flow: 'F',
};

export function FlowBoard({
  runs,
  definitions,
  onOpenRun,
}: {
  runs: FlowRunDetail[];
  definitions: Map<string, FlowDefinition>;
  onOpenRun: (runId: string) => void;
}) {
  const now = useNow(runs.some((run) => run.status === 'running'));
  const entries = runs.map((run) => {
    const key = `${run.definition.id}@${run.definition.version}`;
    const definition = definitions.get(key);
    const cards = definition ? collectFlowCards(definition) : [];
    const focus = focusStep(run);
    const node = focus ? cards.find((card) => card.node.id === focus.nodeId)?.node : undefined;
    const stage = focus ? cards.find((card) => card.node.id === focus.nodeId)?.stage : undefined;
    const done = run.steps.filter((step) => step.status === 'ended').length;
    const total = cards.length;

    return {
      run,
      column: runColumn(run),
      focus,
      node,
      stage,
      done,
      total,
      type: (focus?.type ?? 'flow') as CardType,
    };
  });

  return (
    <div className="kanban">
      {columns.map((column) => {
        const columnEntries = entries.filter((entry) => entry.column === column.key);
        return (
          <section key={column.key} className={`kanban-column kanban-column-${column.key}`}>
            <header>
              <h3>{column.label}</h3>
              <span className="count">{columnEntries.length}</span>
            </header>
            <div className="kanban-cards">
              {columnEntries.map((entry) => {
                const { run, focus, node, stage, done, total, type } = entry;
                const goalText = run.goal.description ?? run.goal.id;
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;

                return (
                  <article
                    key={run.id}
                    className={`kanban-card kanban-card-${type}${run.status === 'running' ? ' is-running' : ''}`}
                    role="button"
                    tabIndex={0}
                    title="Open flow instance"
                    onClick={() => onOpenRun(run.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenRun(run.id);
                      }
                    }}
                  >
                    <div className="card-top">
                      <span className={`type-avatar type-${type}`} aria-hidden="true">
                        {typeInitial[type]}
                      </span>
                      <div className="card-heading">
                        <div className="card-node" title={`${run.definition.id}@${run.definition.version}`}>
                          {run.definition.id}@{run.definition.version}
                        </div>
                        <div className="card-stage" title={stage ?? 'Current step'}>
                          {focus ? `at ${focus.nodeId}` : 'no steps yet'}
                        </div>
                      </div>
                      <StatusBadge status={flowDisplayStatus(run)} />
                    </div>

                    <p className="card-summary" title={goalText}>
                      goal {goalText}
                    </p>

                    <div className="card-note" title={node ? summaryOf(node) : undefined}>
                      {focus
                        ? `${focus.type} · ${node ? summaryOf(node) : focus.nodeId}`
                        : 'Waiting for the first step'}
                    </div>

                    <div className="card-progress">
                      <div className="card-progress-bar">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <span className="card-progress-text">
                        {done}/{total || '—'}
                      </span>
                    </div>

                    <div className="card-footer">
                      <span className="card-time" title="elapsed time">
                        {focus ? timingOf(focus, now) : ''}
                      </span>
                      <span className="muted small" title={run.id}>
                        run {run.id.slice(0, 8)}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}
