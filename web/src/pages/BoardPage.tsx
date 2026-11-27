import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type { FlowDefinition } from '@shared/model';
import type { FlowOperatorBody, HumanRespondBody } from '@shared/api-types';
import { api } from '../api';
import { collectFlowCards, focusStep } from '../components/card-utils';
import { FlowBoard } from '../components/FlowBoard';
import { OperationModal } from '../components/OperationModal';

export function BoardPage() {
  const { runId } = useParams<{ runId?: string }>();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runId ?? null);

  useEffect(() => {
    if (runId) {
      setSelectedRunId(runId);
    }
  }, [runId]);

  const board = useQuery({
    queryKey: ['board'],
    queryFn: api.board,
    refetchInterval: 2000,
  });

  const refs = useMemo(() => {
    const seen = new Set<string>();
    const list: { id: string; version: string }[] = [];
    for (const run of board.data ?? []) {
      const key = `${run.definition.id}@${run.definition.version}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(run.definition);
      }
    }
    return list;
  }, [board.data]);

  const definitionQueries = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ['flow-definition', ref.id, ref.version],
      queryFn: () => api.flowDefinition(ref.id, ref.version),
      staleTime: Infinity,
    })),
  });

  const definitions = useMemo(() => {
    const map = new Map<string, FlowDefinition>();
    refs.forEach((ref, index) => {
      const data = definitionQueries[index]?.data;
      if (data) {
        map.set(`${ref.id}@${ref.version}`, data);
      }
    });
    return map;
  }, [refs, definitionQueries]);

  const respond = useMutation({
    mutationFn: (input: { flowInstanceId: string; nodeId: string; body: HumanRespondBody }) =>
      api.respondHumanNode(input.flowInstanceId, input.nodeId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  const operate = useMutation({
    mutationFn: (input: { runId: string; body: FlowOperatorBody }) => api.operateFlowRun(input.runId, input.body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  if (board.isLoading) {
    return <div className="board-loading muted">Loading board…</div>;
  }

  if (board.error || !board.data) {
    return (
      <div className="board-loading error-text">
        {board.error instanceof Error ? board.error.message : String(board.error)}
      </div>
    );
  }

  const selectedRun = selectedRunId ? board.data.find((run) => run.id === selectedRunId) : undefined;
  const selectedDefinition = selectedRun
    ? definitions.get(`${selectedRun.definition.id}@${selectedRun.definition.version}`)
    : undefined;
  const selectedFocus = selectedRun ? focusStep(selectedRun) : undefined;
  const selectedCard =
    selectedDefinition && selectedFocus
      ? collectFlowCards(selectedDefinition).find((card) => card.node.id === selectedFocus.nodeId)
      : undefined;

  return (
    <div className="flow-board-page">
      <FlowBoard runs={board.data} definitions={definitions} onOpenRun={setSelectedRunId} />

      {selectedRun && selectedDefinition && selectedFocus && selectedCard ? (
        <OperationModal
          flowRun={selectedRun}
          definition={selectedDefinition}
          node={selectedCard.node}
          nodeRun={selectedFocus}
          stage={selectedCard.stage}
          onClose={() => setSelectedRunId(null)}
          onRespond={(body) =>
            respond
              .mutateAsync({ flowInstanceId: selectedRun.id, nodeId: selectedFocus.nodeId, body })
              .then(() => undefined)
          }
          onOperate={(body) =>
            operate.mutateAsync({ runId: selectedRun.id, body }).then(() => undefined)
          }
        />
      ) : null}
    </div>
  );
}
