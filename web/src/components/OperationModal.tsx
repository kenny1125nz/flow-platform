import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@tanstack/react-query';
import type { FlowDefinition, FlowNode, NodeRun, TierKind, UnitStatus } from '@shared/model';
import type { FlowOperatorAction, FlowOperatorBody, FlowRunDetail, HumanRespondBody } from '@shared/api-types';
import { api } from '../api';
import { rendererRegistry } from '../renderers';
import {
  activeTierKind,
  collectFlowCards,
  displayStatus,
  flowDisplayStatus,
  formatTokens,
  humanTierOf,
  summaryOf,
  timingOf,
  tokenBreakdown,
} from './card-utils';
import { DefinitionDiagram } from './DefinitionDiagram';
import { JsonBlock } from './JsonBlock';
import { StatusBadge } from './StatusBadge';

const typeInitial: Record<TierKind | 'flow', string> = {
  human: 'H',
  agent: 'A',
  script: 'S',
  flow: 'F',
};

type RunDetailTab = 'facts' | 'step' | 'diagram' | 'steps';

export function OperationModal({
  flowRun,
  definition,
  node,
  nodeRun,
  stage,
  onClose,
  onRespond,
  onOperate,
}: {
  flowRun: FlowRunDetail;
  definition: FlowDefinition;
  node: FlowNode;
  nodeRun: NodeRun;
  stage: string;
  onClose: () => void;
  onRespond: (body: HumanRespondBody) => Promise<void>;
  onOperate: (body: FlowOperatorBody) => Promise<void>;
}) {
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<RunDetailTab>('step');
  const tabId = (key: RunDetailTab) => `${titleId}-tab-${key}`;
  const panelId = (key: RunDetailTab) => `${titleId}-panel-${key}`;
  const now = useNow(flowRun.steps.some((step) => step.status === 'running'));
  const stageByNode = new Map(collectFlowCards(definition).map((card) => [card.node.id, card.stage]));
  const goalText = flowRun.goal.description ?? flowRun.goal.id;
  const activeKind = activeTierKind(nodeRun) ?? node.tiers[0]?.kind ?? 'flow';
  const humanTier = humanTierOf(node);
  const isHumanAction = activeKind === 'human' && nodeRun.status === 'running';
  const Renderer = isHumanAction ? rendererRegistry[`${flowRun.definition.id}:${node.id}`] : undefined;
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
            <span className={`type-avatar type-${activeKind}`} aria-hidden="true">
              {typeInitial[activeKind]}
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
            <RunControls runId={flowRun.id} status={flowRun.status} suspended={flowRun.suspended} />
            <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <div className="modal-body">
          <RunLinks flowRun={flowRun} />
          <div className="tab-bar modal-tabs" role="tablist" aria-label="Run details">
            <button
              type="button"
              role="tab"
              id={tabId('facts')}
              aria-selected={activeTab === 'facts'}
              aria-controls={panelId('facts')}
              className={`tab${activeTab === 'facts' ? ' active' : ''}`}
              onClick={() => setActiveTab('facts')}
            >
              Flow instance
            </button>
            <button
              type="button"
              role="tab"
              id={tabId('step')}
              aria-selected={activeTab === 'step'}
              aria-controls={panelId('step')}
              className={`tab${activeTab === 'step' ? ' active' : ''}`}
              onClick={() => setActiveTab('step')}
            >
              Current step
            </button>
            <button
              type="button"
              role="tab"
              id={tabId('diagram')}
              aria-selected={activeTab === 'diagram'}
              aria-controls={panelId('diagram')}
              className={`tab${activeTab === 'diagram' ? ' active' : ''}`}
              onClick={() => setActiveTab('diagram')}
            >
              Flow diagram
            </button>
            <button
              type="button"
              role="tab"
              id={tabId('steps')}
              aria-selected={activeTab === 'steps'}
              aria-controls={panelId('steps')}
              className={`tab${activeTab === 'steps' ? ' active' : ''}`}
              onClick={() => setActiveTab('steps')}
            >
              Execution steps
            </button>
          </div>

          <section
            id={panelId('facts')}
            role="tabpanel"
            aria-labelledby={tabId('facts')}
            hidden={activeTab !== 'facts'}
            className="modal-section"
          >
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

          <section
            id={panelId('step')}
            role="tabpanel"
            aria-labelledby={tabId('step')}
            hidden={activeTab !== 'step'}
            className="modal-section"
          >
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

            {flowRun.status === 'paused' ? (
              <OperatorActions nodeId={node.id} definition={definition} onOperate={onOperate} />
            ) : null}

            {isHumanAction ? (
              Renderer ? (
                <Renderer
                  flowInstanceId={flowRun.id}
                  nodeId={node.id}
                  prompt={humanTier?.prompt ?? ''}
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
                <HumanResponseForm
                  prompt={humanTier?.prompt ?? 'Waiting for your decision.'}
                  assignee={humanTier?.assignee}
                  node={node}
                  onRespond={onRespond}
                  onClose={onClose}
                />
              )
            ) : flowRun.status === 'paused' ? null : (
              <div className="modal-empty">No operator actions are available for this step.</div>
            )}
          </section>

          <section
            id={panelId('diagram')}
            role="tabpanel"
            aria-labelledby={tabId('diagram')}
            hidden={activeTab !== 'diagram'}
            className="modal-section modal-diagram-section"
          >
            <h3>Flow diagram</h3>
            <div className="modal-diagram">
              <DefinitionDiagram definition={definition} kind="flow" />
            </div>
          </section>

          <section
            id={panelId('steps')}
            role="tabpanel"
            aria-labelledby={tabId('steps')}
            hidden={activeTab !== 'steps'}
            className="modal-section"
          >
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
                    <th>Tokens</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {flowRun.steps.map((step, index) => (
                    <tr key={`${step.nodeId}-${index}`} className={step.nodeId === node.id ? 'current' : ''}>
                      <td>{step.nodeId}</td>
                      <td>{activeTierKind(step) ?? '—'}</td>
                      <td className="muted">{stageByNode.get(step.nodeId) ?? '—'}</td>
                      <td>
                        <StatusBadge status={displayStatus(step)} />
                      </td>
                      <td className="muted">{timingOf(step, now)}</td>
                      <td className="muted">
                        {step.usage ? (
                          <span title={tokenBreakdown(step.usage)}>{formatTokens(step.usage)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
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

type RunLink = {
  label: string;
  href: string;
  detail?: string;
};

function RunLinks({ flowRun }: { flowRun: FlowRunDetail }) {
  const links = runLinks(flowRun);
  if (links.length === 0) {
    return null;
  }

  return (
    <nav className="modal-links" aria-label="Key links">
      {links.map((link) => (
        <a
          key={link.label}
          className="modal-link"
          href={link.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          <span className="modal-link-label">{link.label}</span>
          {link.detail ? <span className="modal-link-detail">{link.detail}</span> : null}
        </a>
      ))}
    </nav>
  );
}

function runLinks(flowRun: FlowRunDetail): RunLink[] {
  const repo = parseRepo(flowRun.context?.repo);
  const repoBase = repo ? `https://github.com/${repo.owner}/${repo.name}` : undefined;
  const branch =
    latestStepOutput<{ branch?: string }>(flowRun.steps, 'prepare-branch')?.branch ??
    flowRun.context?.branch;
  const issue = latestStepOutput<{ issue?: { number?: number; url?: string } }>(
    flowRun.steps,
    'create-ticket',
  )?.issue;
  const pr = latestStepOutput<{ pr?: { number?: number; url?: string } }>(
    flowRun.steps,
    'commit-and-pr',
  )?.pr;

  const links: RunLink[] = [];

  if (repoBase) {
    links.push({ label: 'GitHub', href: repoBase, detail: `${repo?.owner}/${repo?.name}` });
  }
  if (pr?.url) {
    links.push({
      label: 'Pull request',
      href: pr.url,
      detail: pr.number ? `#${pr.number}` : undefined,
    });
  }
  if (issue?.url) {
    links.push({
      label: 'Issue',
      href: issue.url,
      detail: issue.number ? `#${issue.number}` : undefined,
    });
  } else if (repoBase && flowRun.context?.issueId) {
    links.push({
      label: 'Issue',
      href: `${repoBase}/issues/${flowRun.context.issueId}`,
      detail: `#${flowRun.context.issueId}`,
    });
  }
  if (repoBase && branch) {
    links.push({ label: 'Branch', href: `${repoBase}/tree/${branch}`, detail: branch });
  }

  return links;
}

function parseRepo(repo?: string): { owner: string; name: string } | undefined {
  if (!repo) {
    return undefined;
  }
  const cleaned = repo.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const github = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/);
  if (github) {
    return { owner: github[1], name: github[2] };
  }
  const parts = cleaned.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], name: parts[1] };
  }
  return undefined;
}

function latestStepOutput<T>(steps: NodeRun[], nodeId: string): T | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].nodeId === nodeId && steps[index].output !== undefined) {
      return steps[index].output as T;
    }
  }
  return undefined;
}

function OperatorActions({
  nodeId,
  definition,
  onOperate,
}: {
  nodeId: string;
  definition: FlowDefinition;
  onOperate: (body: FlowOperatorBody) => Promise<void>;
}) {
  const cards = collectFlowCards(definition);
  const [target, setTarget] = useState(nodeId);
  const [pending, setPending] = useState<FlowOperatorAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: FlowOperatorAction, id: string) => {
    setPending(action);
    setError(null);
    try {
      await onOperate({ action, nodeId: id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="modal-human-form operator-actions">
      <div className="modal-section-head">
        <span>This run is paused / blocked</span>
        <span className="muted small">Choose how to recover</span>
      </div>

      <div className="modal-field-label">Recover the blocked step</div>
      <div className="operator-buttons">
        <button
          type="button"
          className="decision-option"
          disabled={pending !== null}
          onClick={() => void run('retry', nodeId)}
        >
          Re-run this step
        </button>
        <button
          type="button"
          className="decision-option"
          disabled={pending !== null}
          onClick={() => void run('skip', nodeId)}
        >
          Skip this step
        </button>
      </div>

      <div className="modal-field-label">Jump to a step</div>
      <div className="operator-jump">
        <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={pending !== null}>
          {cards.map((card) => (
            <option key={card.node.id} value={card.node.id}>
              {card.node.id} · {card.stage}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="run-control"
          disabled={pending !== null}
          onClick={() => void run('jump', target)}
        >
          Jump
        </button>
      </div>

      {pending !== null ? <div className="muted small">Applying…</div> : null}
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}

function RunControls({
  runId,
  status,
  suspended,
}: {
  runId: string;
  status: UnitStatus;
  suspended?: boolean;
}) {
  const cancel = useMutation({ mutationFn: () => api.cancelRun(runId) });
  const pause = useMutation({ mutationFn: () => api.pauseRun(runId) });
  const resume = useMutation({ mutationFn: () => api.resumeRun(runId) });

  const active = status === 'running';

  return (
    <div className="run-controls">
      {active && !suspended ? (
        <button type="button" className="run-control" disabled={pause.isPending} onClick={() => void pause.mutate()}>
          Pause
        </button>
      ) : null}
      {suspended ? (
        <button type="button" className="run-control" disabled={resume.isPending} onClick={() => void resume.mutate()}>
          Resume
        </button>
      ) : null}
      {active ? (
        <button type="button" className="run-control danger" disabled={cancel.isPending} onClick={() => void cancel.mutate()}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

function HumanResponseForm({
  prompt,
  assignee,
  node,
  onRespond,
  onClose,
}: {
  prompt: string;
  assignee?: string;
  node: FlowNode;
  onRespond: (body: HumanRespondBody) => Promise<void>;
  onClose: () => void;
}) {
  const options = decisionOptions(node);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  const respond = async (label?: string) => {
    setPending(true);
    setError(null);
    try {
      await onRespond({
        outcome: 'succeeded',
        ...(label === undefined ? {} : { label }),
        ...(feedback.trim() ? { data: { feedback: feedback.trim() } } : {}),
      });
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
        <span>{prompt}</span>
        {assignee ? <span className="muted small">{assignee}</span> : null}
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
          <textarea
            className="spec-evidence"
            rows={2}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Feedback (optional) — e.g. why this needs rework…"
          />
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

function decisionOptions(node: FlowNode): string[] {
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
