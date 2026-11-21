import { Link } from 'react-router-dom';
import type { PlanRunDetail } from '@shared/api-types';
import { StatusBadge } from './StatusBadge';

export function PlanView({ run }: { run: PlanRunDetail }) {
  return (
    <div className="plan-view">
      {run.steps.map((step, index) => (
        <article key={step.nodeId} className="plan-node">
          <div className="plan-node-index">{index + 1}</div>
          <div className="plan-node-body">
            <div className="row-between">
              <h3>{step.nodeId}</h3>
              {step.flowStatus ? <StatusBadge status={step.flowStatus} /> : <span className="muted small">waiting</span>}
            </div>
            <div className="muted small">
              flow: {step.flow.id}@{step.flow.version}
            </div>
            <div className="goal">
              <span className="muted small">goal</span>
              <div>{step.goal.description ?? step.goal.id}</div>
            </div>
            {step.next ? (
              <div className="muted small">next: {JSON.stringify(step.next)}</div>
            ) : (
              <div className="muted small">terminal</div>
            )}
            {step.flowResult?.label ? <span className="pill">label: {step.flowResult.label}</span> : null}
            {step.flowResult?.error ? <span className="error-text">{step.flowResult.error.code}</span> : null}
            {step.flowInstanceId ? (
              <Link className="inline-link" to={`/runs/${step.flowInstanceId}`}>
                Open flow run →
              </Link>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
