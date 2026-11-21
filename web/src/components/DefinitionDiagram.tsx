import { useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { FlowDefinition, FlowNode, PlanDefinition, PlanNode } from '@shared/model';
import {
  layoutFlowDefinition,
  layoutPlanDefinition,
  type DiagramEdge,
  type DiagramStage,
} from '../diagram/layout';
import { collectFlowCards } from './card-utils';

type NodeRef = { node: FlowNode | PlanNode; stage?: string };

export function DefinitionDiagram({
  definition,
  kind,
  onSelectNode,
}: {
  definition: FlowDefinition | PlanDefinition;
  kind: 'flow' | 'plan';
  onSelectNode?: (node: FlowNode | PlanNode, stage?: string) => void;
}) {
  const markerId = `diagram-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setCollapsed(new Set());
  }, [definition]);

  const nodeRefs = useMemo<Map<string, NodeRef>>(() => {
    const map = new Map<string, NodeRef>();
    if (kind === 'flow') {
      for (const card of collectFlowCards(definition as FlowDefinition)) {
        map.set(card.node.id, { node: card.node, stage: card.stage });
      }
    } else {
      for (const node of (definition as PlanDefinition).nodes) {
        map.set(node.id, { node });
      }
    }
    return map;
  }, [definition, kind]);

  const diagram = useMemo(
    () =>
      kind === 'flow'
        ? layoutFlowDefinition(definition as FlowDefinition, collapsed)
        : layoutPlanDefinition(definition as PlanDefinition),
    [definition, kind, collapsed],
  );

  const toggleStage = (stageId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(stageId)) {
        next.delete(stageId);
      } else {
        next.add(stageId);
      }
      return next;
    });
  };

  if (diagram.nodes.length === 0 && diagram.stages.length === 0) {
    return <div className="muted">This definition has no nodes.</div>;
  }

  return (
    <div className="diagram-scroll">
      <svg
        className="definition-diagram"
        width={diagram.width}
        height={diagram.height}
        viewBox={`0 0 ${diagram.width} ${diagram.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`${kind} definition diagram`}
      >
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="diagram-arrow" />
          </marker>
        </defs>

        {diagram.stages.map((stage) => (
          <rect
            key={`box-${stage.id}`}
            className={`diagram-stage-box${stage.collapsed ? ' collapsed' : ''}`}
            x={stage.x}
            y={stage.y}
            width={stage.width}
            height={stage.height}
            rx={14}
          />
        ))}

        {diagram.edges.map((edge) => (
          <Edge key={edge.id} edge={edge} markerId={markerId} />
        ))}

        {diagram.nodes.map((node) => {
          const ref = nodeRefs.get(node.id);
          const clickable = onSelectNode !== undefined && ref !== undefined;
          const select = () => {
            if (ref) {
              onSelectNode?.(ref.node, ref.stage);
            }
          };
          return (
            <g
              key={node.id}
              transform={`translate(${node.x},${node.y})`}
              className={`diagram-node diagram-node-${node.kind}${clickable ? ' clickable' : ''}`}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? select : undefined}
              onKeyDown={
                clickable
                  ? (event: KeyboardEvent<SVGGElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        select();
                      }
                    }
                  : undefined
              }
            >
              <rect width={node.width} height={node.height} rx={12} />
              <text x={node.width / 2} y={node.height / 2 - 4} textAnchor="middle" className="diagram-node-label">
                {node.label}
              </text>
              <text x={node.width / 2} y={node.height / 2 + 11} textAnchor="middle" className="diagram-node-sub">
                {node.sublabel}
              </text>
            </g>
          );
        })}

        {diagram.stages.map((stage) => (
          <StageHeader key={`header-${stage.id}`} stage={stage} onToggle={() => toggleStage(stage.id)} />
        ))}
      </svg>
    </div>
  );
}

function StageHeader({ stage, onToggle }: { stage: DiagramStage; onToggle: () => void }) {
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <g
      className={`diagram-stage-header${stage.collapsed ? ' collapsed' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={!stage.collapsed}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <rect
        className="diagram-stage-header-bg"
        x={stage.x}
        y={stage.y}
        width={stage.width}
        height={stage.collapsed ? stage.height : 20}
        rx={10}
        pointerEvents="all"
      />
      <text
        className="diagram-stage-title"
        x={stage.x + 10}
        y={stage.collapsed ? stage.y + stage.height / 2 - 4 : stage.y + 14}
      >
        {stage.label}
      </text>
      <text
        className="diagram-stage-meta"
        x={stage.x + stage.width - 32}
        y={stage.collapsed ? stage.y + stage.height / 2 - 4 : stage.y + 14}
        textAnchor="end"
      >
        {stage.nodeCount} steps
      </text>
      <text
        className="diagram-stage-toggle"
        x={stage.x + stage.width - 12}
        y={stage.collapsed ? stage.y + stage.height / 2 - 3 : stage.y + 15}
        textAnchor="end"
      >
        {stage.collapsed ? '+' : '−'}
      </text>
      {stage.collapsed ? (
        <text className="diagram-stage-hint" x={stage.x + 10} y={stage.y + stage.height / 2 + 11}>
          click to expand
        </text>
      ) : null}
    </g>
  );
}

function Edge({ edge, markerId }: { edge: DiagramEdge; markerId: string }) {
  const path = edge.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const labelWidth = edge.label ? edge.label.length * 7 + 10 : 0;

  return (
    <g>
      <path className="diagram-edge" d={path} markerEnd={`url(#${markerId})`} />
      {edge.label && edge.labelX !== undefined && edge.labelY !== undefined ? (
        <g>
          <rect
            className="diagram-edge-label-bg"
            x={edge.labelX - labelWidth / 2}
            y={edge.labelY - 9}
            width={labelWidth}
            height={18}
            rx={9}
          />
          <text x={edge.labelX} y={edge.labelY + 4} textAnchor="middle" className="diagram-edge-label">
            {edge.label}
          </text>
        </g>
      ) : null}
    </g>
  );
}
