import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { JsonBlock } from '../components/JsonBlock';
import { PlanView } from '../components/PlanView';
import { StatusBadge } from '../components/StatusBadge';

export function PlanRunPage() {
  const { runId = '' } = useParams();
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.run(runId),
    enabled: runId.length > 0,
    refetchInterval: 2000,
  });

  if (run.isLoading) {
    return <div className="board-loading muted">Loading plan…</div>;
  }

  if (run.error || !run.data) {
    return (
      <div className="board-loading error-text">
        {run.error instanceof Error ? run.error.message : String(run.error)}
      </div>
    );
  }

  const detail = run.data;
  if (detail.kind !== 'plan') {
    return (
      <div className="board-loading muted">
        This run is a flow instance. <Link to={`/runs/${detail.id}`}>Open it on the board</Link>.
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">← Board</Link>
      </div>
      <header className="page-header row-between">
        <div>
          <h1>
            plan · {detail.definition.id}@{detail.definition.version}
          </h1>
          <p className="muted small">
            created {formatTime(detail.createdAt)} · updated {formatTime(detail.updatedAt)}
          </p>
        </div>
        <div className="row-gap">
          {detail.result?.label ? <span className="pill">label: {detail.result.label}</span> : null}
          <StatusBadge status={detail.status} />
        </div>
      </header>

      <section className="panel">
        <h2>Plan</h2>
        <PlanView run={detail} />
      </section>

      {detail.result ? (
        <section className="panel">
          <h2>Result</h2>
          <JsonBlock value={detail.result} />
        </section>
      ) : null}
    </div>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString();
}
