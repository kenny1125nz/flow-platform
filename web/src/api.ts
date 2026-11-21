import type {
  CreateFlowRunBody,
  CreatePlanRunBody,
  DefinitionSummary,
  FlowRunDetail,
  HumanRespondBody,
  PlanRunDetail,
  RunDetail,
  RunSummary,
} from '@shared/api-types';
import type { FlowDefinition, Goal, PlanDefinition, WorkContext } from '@shared/model';

export class ApiError extends Error {
  readonly status: number;
  readonly issues?: { path: string; message: string }[];

  constructor(status: number, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const errorBody = body as { error?: string; issues?: { path: string; message: string }[] } | undefined;
    throw new ApiError(
      response.status,
      errorBody?.error ?? `Request failed with ${response.status}`,
      errorBody?.issues,
    );
  }

  return body as T;
}

export const api = {
  definitions: () => request<DefinitionSummary[]>('/definitions'),
  flowDefinition: (id: string, version: string) =>
    request<FlowDefinition>(`/flows/${encodeURIComponent(id)}/${encodeURIComponent(version)}`),
  nodeSource: (id: string, version: string, nodeId: string) =>
    request<{ files: { path: string; content: string }[] }>(
      `/flows/${encodeURIComponent(id)}/${encodeURIComponent(version)}/nodes/${encodeURIComponent(nodeId)}/source`,
    ),
  planDefinition: (id: string, version: string) =>
    request<PlanDefinition>(`/plans/${encodeURIComponent(id)}/${encodeURIComponent(version)}`),
  runs: () => request<RunSummary[]>('/runs'),
  run: (id: string) => request<RunDetail>(`/runs/${encodeURIComponent(id)}`),
  board: () => request<FlowRunDetail[]>('/board'),
  flowRuns: () => request<RunSummary[]>('/flow-runs'),
  flowRun: (id: string) => request<FlowRunDetail>(`/flow-runs/${encodeURIComponent(id)}`),
  planRuns: () => request<RunSummary[]>('/plan-runs'),
  planRun: (id: string) => request<PlanRunDetail>(`/plan-runs/${encodeURIComponent(id)}`),
  startFlowRun: (id: string, version: string, goal: Goal, context?: WorkContext) =>
    request<{ runId: string; status: string }>(`/flows/${encodeURIComponent(id)}/${encodeURIComponent(version)}/runs`, {
      method: 'POST',
      body: JSON.stringify({ goal, ...(context === undefined ? {} : { context }) } satisfies CreateFlowRunBody),
    }),
  startPlanRun: (id: string, version: string, context?: WorkContext) =>
    request<{ runId: string; status: string }>(`/plans/${encodeURIComponent(id)}/${encodeURIComponent(version)}/runs`, {
      method: 'POST',
      body: JSON.stringify((context === undefined ? {} : { context }) satisfies CreatePlanRunBody),
    }),
  respondHumanNode: (flowInstanceId: string, nodeId: string, body: HumanRespondBody) =>
    request<{ ok: true }>(
      `/flow-runs/${encodeURIComponent(flowInstanceId)}/human/${encodeURIComponent(nodeId)}/respond`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};
