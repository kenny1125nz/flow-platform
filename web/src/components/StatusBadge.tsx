import type { OutcomeStatus, UnitStatus } from '@shared/model';

export function StatusBadge({ status }: { status: UnitStatus | OutcomeStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}
