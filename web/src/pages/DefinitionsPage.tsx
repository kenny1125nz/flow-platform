import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FlowDefinition, FlowNode, PlanDefinition, PlanNode } from '@shared/model';
import { api } from '../api';
import { collectFlowCards } from '../components/card-utils';
import { DefinitionDiagram } from '../components/DefinitionDiagram';
import { NodeInfoModal } from '../components/NodeInfoModal';

type Definition = FlowDefinition | PlanDefinition;

export function DefinitionsPage() {
  const definitions = useQuery({ queryKey: ['definitions'], queryFn: api.definitions });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<{ node: FlowNode | PlanNode; stage?: string } | null>(null);

  const active =
    definitions.data?.find((definition) => keyOf(definition) === selectedKey) ?? definitions.data?.[0];

  const definition = useQuery<Definition>({
    queryKey: ['definition', active?.kind, active?.id, active?.version],
    queryFn: async () =>
      active!.kind === 'plan'
        ? api.planDefinition(active!.id, active!.version)
        : api.flowDefinition(active!.id, active!.version),
    enabled: active !== undefined,
  });

  const selectDefinition = (key: string) => {
    setSelectedKey(key);
    setSelectedNode(null);
  };

  const openNode = (nodeId: string) => {
    if (!definition.data || !active) {
      return;
    }
    if (active.kind === 'flow') {
      const card = collectFlowCards(definition.data as FlowDefinition).find((entry) => entry.node.id === nodeId);
      if (card) {
        setSelectedNode({ node: card.node, stage: card.stage });
      }
    } else {
      const planNode = (definition.data as PlanDefinition).nodes.find((entry) => entry.id === nodeId);
      if (planNode) {
        setSelectedNode({ node: planNode });
      }
    }
  };

  return (
    <div className="page definitions-page">
      {definitions.isLoading ? <div className="muted">Loading Blueprints…</div> : null}
      {definitions.error ? (
        <div className="error-text">
          {definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}
        </div>
      ) : null}

      {definitions.data?.length ? (
        <>
          <div className="tab-bar" role="tablist" aria-label="Blueprints">
            {definitions.data.map((item) => {
              const key = keyOf(item);
              const isActive = active !== undefined && keyOf(active) === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`tab${isActive ? ' active' : ''}`}
                  onClick={() => selectDefinition(key)}
                >
                  <span className={`tab-kind tab-kind-${item.kind}`}>{item.kind}</span>
                  {item.id}@{item.version}
                </button>
              );
            })}
          </div>

          <section className="tab-panel" role="tabpanel">
            {definition.isLoading ? <div className="muted">Loading diagram…</div> : null}
            {definition.error ? (
              <div className="error-text">
                {definition.error instanceof Error ? definition.error.message : String(definition.error)}
              </div>
            ) : null}
            {definition.data && active ? (
              <DefinitionDiagram
                definition={definition.data}
                kind={active.kind}
                onSelectNode={(node, stage) => setSelectedNode({ node, stage })}
              />
            ) : null}
          </section>
        </>
      ) : definitions.isLoading ? null : (
        <div className="muted">No Blueprints yet.</div>
      )}

      {selectedNode ? (
        <NodeInfoModal
          node={selectedNode.node}
          stage={selectedNode.stage}
          flowId={active?.kind === 'flow' ? active.id : undefined}
          version={active?.kind === 'flow' ? active.version : undefined}
          onClose={() => setSelectedNode(null)}
          onOpenNode={openNode}
        />
      ) : null}
    </div>
  );
}

function keyOf(definition: { kind: string; id: string; version: string }): string {
  return `${definition.kind}:${definition.id}@${definition.version}`;
}
