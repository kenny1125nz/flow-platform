import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FlowDefinition, PlanDefinition } from '@shared/model';
import { api } from '../api';
import { DefinitionDiagram } from '../components/DefinitionDiagram';

type Definition = FlowDefinition | PlanDefinition;

export function DefinitionsPage() {
  const definitions = useQuery({ queryKey: ['definitions'], queryFn: api.definitions });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  return (
    <div className="page definitions-page">
      {definitions.isLoading ? <div className="muted">Loading definitions…</div> : null}
      {definitions.error ? (
        <div className="error-text">
          {definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}
        </div>
      ) : null}

      {definitions.data?.length ? (
        <>
          <div className="tab-bar" role="tablist" aria-label="Definitions">
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
                  onClick={() => setSelectedKey(key)}
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
              <DefinitionDiagram definition={definition.data} kind={active.kind} />
            ) : null}
          </section>
        </>
      ) : definitions.isLoading ? null : (
        <div className="muted">No definitions yet.</div>
      )}
    </div>
  );
}

function keyOf(definition: { kind: string; id: string; version: string }): string {
  return `${definition.kind}:${definition.id}@${definition.version}`;
}
