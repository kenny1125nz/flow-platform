import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FlowDefinition, FlowNode, HumanNode, NodeRun, StepType } from '@shared/model';
import type { FlowRunDetail, HumanRespondBody } from '@shared/api-types';
import { rendererRegistry } from '../renderers';
import { collectFlowCards, displayStatus, flowDisplayStatus, summaryOf, timingOf } from './card-utils';
import { DefinitionDiagram } from './DefinitionDiagram';
import { JsonBlock } from './JsonBlock';
import { StatusBadge } from './StatusBadge';

const typeInitial: Record<StepType, string> = {
  human: 'H',
  agent: 'A',
  script: 'S',
};

export function OperationModal({
  flowRun,
  definition,
  node,
  nodeRun,
  stage,
  onClose,
  onRespond,
}: {
  flowRun: FlowRunDetail;
  definition: FlowDefinition;
  node: FlowNode;
  nodeRun: NodeRun;
  stage: string;
  onClose: () => void;
  onRespond: (body: HumanRespondBody) => Promise<void>;
}) {
  const titleId = useId();
  const now = useNow(flowRun.steps.some((step) => step.status === 'running'));
  const stageByNode = new Map(collectFlowCards(definition).map((card) => [card.node.id, card.stage]));
  const goalText = flowRun.goal.description ?? flowRun.goal.id;
  const Renderer = node.type === 'human' ? rendererRegistry[`${flowRun.definition.id}:${node.id}`] : undefined;
  const inputs = Object.fromEntries(
    flowRun.steps.filter((step) => step.output !== undefined).map((step) => [step.nodeId, step.output]),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal modal-large" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div className="card-top">
            <span className={`type-avatar type-${node.type}`} aria-hidden="true">
              {typeInitial[node.type]}
            </span>
            <div className="card-heading">
              <h2 id={titleId}>
                {flowRun.definition.id}@{flowRun.definition.version}
              </h2>
              <div className="card-stage">goal {goalText}</div>
            </div>
          </div>
          <div className="modal-header-actions">
            <StatusBadge status={flowDisplayStatus(flowRun)} />
            <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="modal-body">
          <div className="modal-grid">
            <div className="modal-col">
              <section className="modal-section">
                <h3>Flow instance</h3>
                <dl className="modal-facts">
                  <div>
                    <dt>Flow</dt>
                    <dd>
                      {flowRun.definition.id}@{flowRun.definition.version}
                    </dd>
                  </div>
                  <div>
                    <dt>Goal</dt>
                    <dd>{flowRun.goal.description ?? flowRun.goal.id}</dd>
                  </div>
                  <div>
                    <dt>Run id</dt>
                    <dd className="mono">{flowRun.id}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusBadge status={flowDisplayStatus(flowRun)} />
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDateTime(flowRun.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDateTime(flowRun.updatedAt)}</dd>
                  </div>
                </dl>

                {flowRun.result ? (
                  <div className="modal-subsection">
                    <h4>Flow result</h4>
                    <JsonBlock value={flowRun.result} />
                  </div>
                ) : null}
              </section>

              <section className="modal-section">
                <h3>Current step</h3>
                <div className="modal-row">
                  <span className="modal-label">Step</span>
                  <span>
                    {node.id} · {stage}
                  </span>
                </div>
                <div className="modal-status-row">
                  <StatusBadge status={displayStatus(nodeRun)} />
                  <span className="card-time" title="elapsed time">
                    {timingOf(nodeRun, now)}
                  </span>
                </div>
                <p className="modal-summary">{summaryOf(node)}</p>

                {nodeRun.label ? (
                  <div className="modal-row">
                    <span className="modal-label">Label</span>
                    <span className="card-label">{nodeRun.label}</span>
                  </div>
                ) : null}

                {nodeRun.error ? (
                  <div className="card-error">
                    <span className="card-error-code">{nodeRun.error.code}</span>
                    {nodeRun.error.message ? <span>{nodeRun.error.message}</span> : null}
                    {nodeRun.error.hint ? <span>{nodeRun.error.hint}</span> : null}
                  </div>
                ) : null}

                {node.type === 'human' && nodeRun.status === 'running' ? (
                  Renderer ? (
                    <Renderer
                      flowInstanceId={flowRun.id}
                      nodeId={node.id}
                      prompt={node.prompt ?? ''}
                      inputs={inputs}
                      submit={async (result) => {
                        await onRespond({
                          outcome: result.outcome,
                          ...(result.label === undefined ? {} : { label: result.label }),
                          ...(result.data === undefined ? {} : { data: result.data }),
                        });
                        onClose();
                      }}
                    />
                  ) : (
                    <HumanResponseForm node={node} onRespond={onRespond} onClose={onClose} />
                  )
                ) : (
                  <div className="modal-empty">No operator actions are available for this step.</div>
                )}
              </section>
            </div>

            <div className="modal-col">
              <section className="modal-section">
                <h3>Flow diagram</h3>
                <div className="modal-diagram">
                  <DefinitionDiagram definition={definition} kind="flow" />
                </div>
              </section>
            </div>
          </div>

          <section className="modal-section">
            <h3>Execution steps</h3>
            <div className="modal-table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Type</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Elapsed</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {flowRun.steps.map((step) => (
                    <tr key={step.nodeId} className={step.nodeId === node.id ? 'current' : ''}>
                      <td>{step.nodeId}</td>
                      <td>{step.type}</td>
                      <td className="muted">{stageByNode.get(step.nodeId) ?? '—'}</td>
                      <td>
                        <StatusBadge status={displayStatus(step)} />
                      </td>
                      <td className="muted">{timingOf(step, now)}</td>
                      <td>
                        {step.label ? <span className="card-label">{step.label}</span> : null}
                        {step.error ? <span className="error-text">{step.error.code}</span> : null}
                        {!step.label && !step.error ? <span className="muted">—</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HumanResponseForm({
  node,
  onRespond,
  onClose,
}: {
  node: HumanNode;
  onRespond: (body: HumanRespondBody) => Promise<void>;
  onClose: () => void;
}) {
  const options = decisionOptions(node);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respond = async (label?: string) => {
    setPending(true);
    setError(null);
    try {
      await onRespond(label === undefined ? { outcome: 'succeeded' } : { outcome: 'succeeded', label });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="modal-human-form">
      <div className="modal-section-head">
        <span>{node.prompt ?? 'Waiting for your decision.'}</span>
        {node.assignee ? <span className="muted small">{node.assignee}</span> : null}
      </div>

      {options.length > 0 ? (
        <>
          <div className="modal-field-label">Choose an outcome</div>
          <div className="decision-options">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                className="decision-option"
                disabled={pending}
                onClick={() => void respond(option)}
              >
                {option}
              </button>
            ))}
          </div>
          {pending ? <div className="muted small">Sending decision…</div> : null}
        </>
      ) : (
        <button type="button" className="modal-submit" disabled={pending} onClick={() => void respond()}>
          {pending ? 'Sending…' : 'Complete step'}
        </button>
      )}

      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}

function decisionOptions(node: HumanNode): string[] {
  const next = node.next;
  if (!next || typeof next === 'string' || Array.isArray(next)) {
    return [];
  }
  const errorCodes = new Set((node.errors ?? []).map((error) => error.code));
  const labels = Object.keys(next);
  const positive = labels.filter((label) => !errorCodes.has(label));
  return positive.length > 0 ? positive : labels;
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}
