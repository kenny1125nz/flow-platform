import { useEffect, useId } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { FlowNode, Next, PlanNode, TaskSpec } from '@shared/model';
import { api } from '../api';
import { rendererRegistry, type HumanStepRenderer } from '../renderers';
import { humanTierOf } from './card-utils';
import { JsonBlock } from './JsonBlock';

const previewTaskSpec: TaskSpec = {
  goal: { statement: 'Add a health endpoint', nonGoals: ['auth', 'rate limiting'] },
  constraints: ['keep the /api prefix'],
  scope: { files: ['src/server/app.ts'], mustNotChange: ['src/model.ts'] },
  acceptanceCriteria: [
    {
      id: 'ac1',
      statement: 'GET /api/health returns 200',
      verifyWith: "curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/health",
    },
    { id: 'ac2', statement: 'Response body is { ok: true }', verifyWith: 'curl -s localhost:3000/api/health' },
  ],
  evaluation: { commands: ['npm run build && npm test'], manualChecks: [] },
};

const previewReport = {
  summary: 'Added GET /api/health and wired it into the server.',
  filesChanged: ['src/server/app.ts'],
  criteria: [
    { criterionId: 'ac1', satisfied: true, evidence: 'curl to /api/health returns 200' },
    { criterionId: 'ac2', satisfied: true, evidence: 'curl shows { "ok": true }' },
  ],
  evaluation: [{ command: 'npm test', passed: true, output: '24 pass' }],
};

const previewVerification = { build: { passed: true }, tests: { passed: true } };

export function NodeInfoModal({
  node,
  stage,
  flowId,
  version,
  onClose,
  onOpenNode,
}: {
  node: FlowNode | PlanNode;
  stage?: string;
  flowId?: string;
  version?: string;
  onClose: () => void;
  onOpenNode?: (nodeId: string) => void;
}) {
  const titleId = useId();
  const isFlowNode = 'tiers' in node;
  const rendererKey = isFlowNode && flowId ? `${flowId}:${node.id}` : undefined;
  const Renderer = rendererKey ? rendererRegistry[rendererKey] : undefined;

  const source = useQuery({
    queryKey: ['node-source', flowId, version, node.id],
    queryFn: () => api.nodeSource(flowId!, version!, node.id),
    enabled: isFlowNode && flowId !== undefined && version !== undefined,
  });

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

  const files = source.data?.files ?? [];

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{node.id}</h2>
            <div className="card-stage">
              {isFlowNode ? `${node.tiers.map((tier) => tier.kind).join(' → ')} step` : 'plan node'}
              {stage ? ` · ${stage}` : ''}
            </div>
          </div>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body node-info-grid">
          <div className="node-info-side">
            <FactsSection node={node} stage={stage} onOpenNode={onOpenNode} />
          </div>

          <div className="node-info-main">
            {isFlowNode ? (
              <TierArtifacts node={node} />
            ) : null}

            {isFlowNode ? <IntentionSection files={files} /> : null}

            {Renderer && isFlowNode ? (
              <RendererPreview
                Renderer={Renderer}
                node={node}
                prompt={humanTierOf(node)?.prompt ?? ''}
              />
            ) : null}

            {isFlowNode ? <FilesSection files={files} kind="script" title="Scripts" /> : null}
            {isFlowNode ? <FilesSection files={files} kind="code" title="Schema & code" /> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FactsSection({
  node,
  stage,
  onOpenNode,
}: {
  node: FlowNode | PlanNode;
  stage?: string;
  onOpenNode?: (nodeId: string) => void;
}) {
  const isFlowNode = 'tiers' in node;
  const humanTier = isFlowNode ? humanTierOf(node) : undefined;
  return (
    <section className="modal-section">
      <h3>Step</h3>
      <dl className="modal-facts">
        <Fact label="ID" value={node.id} mono />
        {isFlowNode ? <Fact label="Tiers" value={node.tiers.map((tier) => tier.kind).join(' → ')} /> : null}
        {isFlowNode && node.annotations && Object.keys(node.annotations).length > 0 ? (
          <Fact
            label="Annotations"
            value={Object.entries(node.annotations).map(([key, value]) => `${key}=${value}`).join(', ')}
          />
        ) : null}
        {stage ? <Fact label="Stage" value={stage} /> : null}
        {humanTier?.assignee ? <Fact label="Assignee" value={humanTier.assignee} /> : null}
        {!isFlowNode ? <Fact label="Goal" value={node.goal.id} mono /> : null}
        {!isFlowNode && node.goal.description ? <Fact label="Description" value={node.goal.description} /> : null}
        {!isFlowNode ? <Fact label="Flow" value={`${node.flow.id}@${node.flow.version}`} mono /> : null}
        {isFlowNode
          ? node.tiers.map((tier) =>
              tier.kind === 'script' ? <Fact key="script" label="Run" value={tier.run} mono /> : null,
            )
          : null}
      </dl>

      {isFlowNode && node.criteria && node.criteria.length > 0 ? (
        <div className="modal-subsection">
          <div className="modal-field-label">Acceptance criteria</div>
          <JsonBlock value={node.criteria} />
        </div>
      ) : null}
      {node.errors !== undefined && node.errors.length > 0 ? (
        <div className="modal-subsection">
          <div className="modal-field-label">Errors</div>
          <JsonBlock value={node.errors} />
        </div>
      ) : null}
      {node.next !== undefined ? (
        <div className="modal-subsection">
          <div className="modal-field-label">Routing</div>
          <Routing next={node.next} onOpenNode={onOpenNode} />
        </div>
      ) : null}
    </section>
  );
}

// One artifact per tier contract: the agent tier's instruction, the human tier's prompt,
// and the script tier's run command.
function TierArtifacts({ node }: { node: FlowNode }) {
  return (
    <>
      {node.tiers.map((tier) => {
        if (tier.kind === 'agent') {
          return <TextArtifact key="agent" title="Agent instruction" text={tier.instruction} />;
        }
        if (tier.kind === 'human' && tier.prompt) {
          return <TextArtifact key="human" title="Human prompt" text={tier.prompt} />;
        }
        return null;
      })}
    </>
  );
}

function IntentionSection({ files }: { files: { path: string; content: string }[] }) {
  const intention = files.find((file) => file.path === 'intention.md');
  if (!intention) {
    return null;
  }
  return (
    <section className="modal-section">
      <h3>Intention</h3>
      <Markdown source={intention.content} />
    </section>
  );
}

function FilesSection({
  files,
  kind,
  title,
}: {
  files: { path: string; content: string }[];
  kind: 'script' | 'code';
  title: string;
}) {
  const matches = files.filter((file) => classifyFile(file.path) === kind);
  if (matches.length === 0) {
    return null;
  }
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      {matches.map((file) => (
        <div key={file.path} className="modal-subsection">
          <div className="modal-field-label">{file.path}</div>
          <pre className="json-block">{file.content}</pre>
        </div>
      ))}
    </section>
  );
}

function TextArtifact({ title, text }: { title: string; text: string }) {
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      <Markdown source={text} />
    </section>
  );
}

function RendererPreview({
  Renderer,
  node,
  prompt,
}: {
  Renderer: HumanStepRenderer;
  node: FlowNode;
  prompt: string;
}) {
  return (
    <section className="modal-section">
      <div className="modal-section-head">
        <h3>Renderer</h3>
        <span className="muted small">live preview · sample data</span>
      </div>
      <div className="renderer-preview">
        <Renderer
          flowInstanceId="preview"
          nodeId={node.id}
          prompt={prompt}
          inputs={{ 'define-spec': previewTaskSpec, implement: previewReport, verify: previewVerification }}
          submit={async () => undefined}
        />
      </div>
    </section>
  );
}

function classifyFile(path: string): 'intention' | 'script' | 'code' | 'ignore' {
  if (path === 'intention.md') {
    return 'intention';
  }
  if (path === 'instruction.md' || path === 'prompt.md' || path === 'renderer.tsx') {
    return 'ignore';
  }
  if (/\.(sh|mjs|js|py)$/.test(path)) {
    return 'script';
  }
  return 'code';
}

function Markdown({ source }: { source: string }) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith('# ')) {
      blocks.push(<h4 key={key++}>{inline(line.slice(2))}</h4>);
      index += 1;
    } else if (line.startsWith('```')) {
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith('```')) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={key++} className="json-block">
          {buffer.join('\n')}
        </pre>,
      );
    } else if (line.trim() === '') {
      index += 1;
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </ul>,
      );
    } else {
      const paragraph: string[] = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() !== '' &&
        !lines[index].startsWith('#') &&
        !lines[index].startsWith('```') &&
        !/^\s*[-*]\s+/.test(lines[index])
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      blocks.push(<p key={key++}>{inline(paragraph.join(' '))}</p>);
    }
  }

  return <div className="markdown">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function Routing({ next, onOpenNode }: { next: Next; onOpenNode?: (nodeId: string) => void }) {
  if (typeof next === 'string') {
    return <RouteRow label="success" targets={[next]} onOpenNode={onOpenNode} />;
  }
  if (Array.isArray(next)) {
    return <RouteRow label="success" targets={next} onOpenNode={onOpenNode} />;
  }
  return (
    <div className="routing">
      {Object.entries(next).map(([label, target]) => (
        <RouteRow
          key={label}
          label={label}
          targets={Array.isArray(target) ? target : [target]}
          onOpenNode={onOpenNode}
        />
      ))}
    </div>
  );
}

function RouteRow({
  label,
  targets,
  onOpenNode,
}: {
  label: string;
  targets: string[];
  onOpenNode?: (nodeId: string) => void;
}) {
  return (
    <div className="routing-row">
      <span className="routing-label">{label}</span>
      <span className="routing-arrow" aria-hidden="true">
        →
      </span>
      <div className="routing-targets">
        {targets.map((target) =>
          onOpenNode ? (
            <button key={target} type="button" className="routing-chip" onClick={() => onOpenNode(target)}>
              {target}
            </button>
          ) : (
            <span key={target} className="routing-chip">
              {target}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}
