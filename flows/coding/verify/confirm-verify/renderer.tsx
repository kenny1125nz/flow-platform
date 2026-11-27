import { useState } from 'react';
import type { ConfirmVerdict, CriterionVerdict, TaskSpec } from '@shared/model';
import type { HumanStepRendererProps } from '@shared/renderer';
import type { ImplementationReport } from '../../make/implement/implementation-report.schema';

type VerificationResult = { build: { passed: boolean }; tests: { passed: boolean } };

export default function ConfirmVerifyRenderer({ inputs, submit }: HumanStepRendererProps) {
  const spec = inputs['define-spec'] as TaskSpec | undefined;
  const report = inputs['implement'] as ImplementationReport | undefined;
  const verification = inputs['verify'] as VerificationResult | undefined;

  const criteria = spec?.acceptanceCriteria ?? [];
  const [verdicts, setVerdicts] = useState<Record<string, CriterionVerdict>>(() =>
    Object.fromEntries(criteria.map((criterion) => [criterion.id, { criterionId: criterion.id, satisfied: false, evidence: '' }])),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  if (!spec || !report) {
    return <div className="modal-empty">No task spec or implementation report available.</div>;
  }

  const reportByCriterion = new Map(report.criteria.map((criterion) => [criterion.criterionId, criterion]));

  const allVerified = criteria.every((criterion) => {
    const verdict = verdicts[criterion.id];
    return verdict?.satisfied === true && verdict.evidence.trim().length > 0;
  });

  const doSubmit = async (label: 'ready' | 'rework') => {
    setPending(true);
    setError(null);
    const data: ConfirmVerdict = {
      criteria: criteria.map((criterion) => verdicts[criterion.id]),
      ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
    };
    try {
      await submit({ outcome: 'succeeded', label, data });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPending(false);
    }
  };

  return (
    <div className="modal-human-form">
      {verification ? (
        <div className="verification-summary">
          <Badge ok={verification.build.passed} label={`build ${verification.build.passed ? 'passed' : 'failed'}`} />
          <Badge ok={verification.tests.passed} label={`tests ${verification.tests.passed ? 'passed' : 'failed'}`} />
        </div>
      ) : null}

      <div className="modal-section-head">
        <span>{report.summary}</span>
      </div>

      {report.filesChanged.length > 0 ? (
        <div>
          <div className="modal-field-label">Files changed</div>
          <div className="routing-targets">
            {report.filesChanged.map((file) => (
              <span key={file} className="routing-chip">
                {file}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="modal-field-label">Acceptance criteria — confirm each with evidence</div>
      {criteria.map((criterion) => {
        const reported = reportByCriterion.get(criterion.id);
        return (
          <CriterionRow
            key={criterion.id}
            statement={criterion.statement}
            verifyWith={criterion.verifyWith}
            reportedSatisfied={reported?.satisfied ?? false}
            reportedEvidence={reported?.evidence}
            verdict={verdicts[criterion.id]}
            onChange={(verdict) => setVerdicts((previous) => ({ ...previous, [criterion.id]: verdict }))}
          />
        );
      })}

      <div className="modal-field-label">Rework feedback (optional)</div>
      <textarea
        className="spec-evidence"
        rows={2}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="If sending back for rework, explain what needs to change…"
      />

      <div className="decision-options">
        <button
          type="button"
          className="modal-submit"
          disabled={!allVerified || pending}
          onClick={() => void doSubmit('ready')}
        >
          {pending ? 'Sending…' : 'Ready for PR review'}
        </button>
        <button type="button" className="decision-option" disabled={pending} onClick={() => void doSubmit('rework')}>
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
  reportedSatisfied,
  reportedEvidence,
  verdict,
  onChange,
}: {
  statement: string;
  verifyWith: string;
  reportedSatisfied: boolean;
  reportedEvidence?: string;
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
            onChange({
              criterionId: verdict?.criterionId ?? '',
              satisfied: event.target.checked,
              evidence: verdict?.evidence ?? '',
            })
          }
        />
        <span>{statement}</span>
      </label>
      <div className="muted small">{verifyWith}</div>
      {reportedEvidence ? (
        <div className="reported-evidence">
          <span className={`reported-dot${reportedSatisfied ? ' ok' : ''}`} />
          implementer: {reportedEvidence}
        </div>
      ) : null}
      <input
        className="spec-evidence"
        type="text"
        placeholder="Your evidence…"
        value={verdict?.evidence ?? ''}
        onChange={(event) =>
          onChange({
            criterionId: verdict?.criterionId ?? '',
            satisfied: verdict?.satisfied ?? false,
            evidence: event.target.value,
          })
        }
      />
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`verify-badge${ok ? ' ok' : ' fail'}`}>{label}</span>;
}
