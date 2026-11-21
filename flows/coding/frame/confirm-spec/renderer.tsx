import { useState } from 'react';
import type { ConfirmVerdict, CriterionVerdict, TaskSpec } from '@shared/model';
import type { HumanStepRendererProps } from '@shared/renderer';

export default function ConfirmSpecRenderer({ inputs, submit }: HumanStepRendererProps) {
  const spec = inputs['define-spec'] as TaskSpec | undefined;
  const criteria = spec?.acceptanceCriteria ?? [];

  const [verdicts, setVerdicts] = useState<Record<string, CriterionVerdict>>(() =>
    Object.fromEntries(
      criteria.map((criterion) => [criterion.id, { criterionId: criterion.id, satisfied: false, evidence: '' }]),
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!spec) {
    return <div className="modal-empty">No task spec available — the define-spec step produced none.</div>;
  }

  const allVerified = criteria.every((criterion) => {
    const verdict = verdicts[criterion.id];
    return verdict?.satisfied === true && verdict.evidence.trim().length > 0;
  });

  const doSubmit = async (label: 'ready' | 'rework') => {
    setPending(true);
    setError(null);
    const data: ConfirmVerdict = { criteria: criteria.map((criterion) => verdicts[criterion.id]) };
    try {
      await submit({ outcome: 'succeeded', label, data });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  };

  return (
    <div className="modal-human-form">
      <div className="modal-section-head">
        <span>{spec.goal.statement}</span>
      </div>

      {spec.goal.nonGoals.length > 0 ? (
        <div>
          <div className="modal-field-label">Non-goals</div>
          <ul className="spec-list">
            {spec.goal.nonGoals.map((nonGoal) => (
              <li key={nonGoal}>{nonGoal}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {spec.constraints.length > 0 ? (
        <div>
          <div className="modal-field-label">Constraints</div>
          <ul className="spec-list">
            {spec.constraints.map((constraint) => (
              <li key={constraint}>{constraint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="modal-field-label">Acceptance criteria — confirm each with evidence</div>
      {criteria.map((criterion) => (
        <CriterionRow
          key={criterion.id}
          statement={criterion.statement}
          verifyWith={criterion.verifyWith}
          verdict={verdicts[criterion.id]}
          onChange={(verdict) => setVerdicts((previous) => ({ ...previous, [criterion.id]: verdict }))}
        />
      ))}

      <div className="decision-options">
        <button
          type="button"
          className="modal-submit"
          disabled={!allVerified || pending}
          onClick={() => void doSubmit('ready')}
        >
          {pending ? 'Sending…' : 'Ready to proceed'}
        </button>
        <button
          type="button"
          className="decision-option"
          disabled={pending}
          onClick={() => void doSubmit('rework')}
        >
          Send back for rework
        </button>
      </div>

      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}

function CriterionRow({
  statement,
  verifyWith,
  verdict,
  onChange,
}: {
  statement: string;
  verifyWith: string;
  verdict: CriterionVerdict | undefined;
  onChange: (verdict: CriterionVerdict) => void;
}) {
  return (
    <div className="spec-criterion">
      <label className="spec-criterion-check">
        <input
          type="checkbox"
          checked={verdict?.satisfied === true}
          onChange={(event) =>
            onChange({ criterionId: verdict?.criterionId ?? '', satisfied: event.target.checked, evidence: verdict?.evidence ?? '' })
          }
        />
        <span>{statement}</span>
      </label>
      <div className="muted small">{verifyWith}</div>
      <input
        className="spec-evidence"
        type="text"
        placeholder="Evidence…"
        value={verdict?.evidence ?? ''}
        onChange={(event) =>
          onChange({ criterionId: verdict?.criterionId ?? '', satisfied: verdict?.satisfied ?? false, evidence: event.target.value })
        }
      />
    </div>
  );
}
