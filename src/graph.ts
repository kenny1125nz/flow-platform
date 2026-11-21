import type { FlowDefinition, FlowNode, Next, PlanDefinition } from './model.js';
import { GraphValidationError, type GraphIssue } from './errors.js';

export type NextResolution =
  | { ok: true; targets: string[] }
  | { ok: false; reason: 'missing-route' };

export function isRecordNext(next: Next | undefined): next is Record<string, string | string[]> {
  return typeof next === 'object' && next !== null && !Array.isArray(next);
}

function asTargets(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

export function resolveNextTargets(
  next: Next | undefined,
  label: string | undefined,
  kind: 'positive' | 'failure',
): NextResolution {
  if (next === undefined) {
    return { ok: true, targets: [] };
  }

  if (typeof next === 'string' || Array.isArray(next)) {
    if (kind === 'failure') {
      return { ok: false, reason: 'missing-route' };
    }
    return { ok: true, targets: asTargets(next) };
  }

  if (label === undefined) {
    return { ok: false, reason: 'missing-route' };
  }

  const target = next[label];
  if (target === undefined) {
    return { ok: false, reason: 'missing-route' };
  }
  return { ok: true, targets: asTargets(target) };
}

export function allNextTargets(next: Next | undefined): string[] {
  if (next === undefined) {
    return [];
  }
  if (typeof next === 'string') {
    return [next];
  }
  if (Array.isArray(next)) {
    return next;
  }
  return Object.values(next).flatMap(asTargets);
}

export function flattenNodes(flow: FlowDefinition): FlowNode[] {
  const nodes: FlowNode[] = [];
  const walk = (stages: FlowDefinition['stages'] | undefined): void => {
    for (const stage of stages ?? []) {
      nodes.push(...stage.nodes);
      walk(stage.substages);
    }
  };
  walk(flow.stages);
  return nodes;
}

export function nodeIndex(flow: FlowDefinition): Map<string, FlowNode> {
  return new Map(flattenNodes(flow).map((node) => [node.id, node]));
}

export function entryNodeIds(flow: FlowDefinition): string[] {
  const nodes = flattenNodes(flow);
  const { backEdges, edgeKey } = findBackEdges(nodes);
  const incoming = new Set<string>();

  for (const node of nodes) {
    for (const target of allNextTargets(node.next)) {
      if (!backEdges.has(edgeKey(node.id, target))) {
        incoming.add(target);
      }
    }
  }

  return nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
}

export function validateFlowDefinition(flow: FlowDefinition): void {
  const issues: GraphIssue[] = [];
  const nodes = flattenNodes(flow);
  const ids = new Set<string>();

  for (const node of nodes) {
    if (ids.has(node.id)) {
      issues.push({ path: `nodes.${node.id}`, message: 'duplicate node id' });
    }
    ids.add(node.id);
  }

  for (const node of nodes) {
    validateNext(`nodes.${node.id}.next`, node, ids, issues);
  }

  if (issues.length > 0) {
    throw new GraphValidationError(issues);
  }
}

export function validatePlanDefinition(plan: PlanDefinition): void {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();

  for (const node of plan.nodes) {
    if (ids.has(node.id)) {
      issues.push({ path: `nodes.${node.id}`, message: 'duplicate plan node id' });
    }
    ids.add(node.id);
  }

  for (const node of plan.nodes) {
    validateNext(`nodes.${node.id}.next`, node, ids, issues, 'plan node');
  }

  if (issues.length > 0) {
    throw new GraphValidationError(issues);
  }
}

function validateNext(
  path: string,
  node: Pick<FlowNode, 'errors' | 'next'>,
  ids: Set<string>,
  issues: GraphIssue[],
  targetKind = 'node',
): void {
  const next = node.next;
  const errors = node.errors;

  if (errors && errors.length > 0 && (typeof next === 'string' || Array.isArray(next))) {
    issues.push({
      path,
      message: 'a node with declared errors must use a label map for next',
    });
  }

  if (isRecordNext(next)) {
    for (const [label, value] of Object.entries(next)) {
      for (const target of asTargets(value)) {
        if (!ids.has(target)) {
          issues.push({ path: `${path}.${label}`, message: `target ${targetKind} "${target}" does not exist` });
        }
      }
    }
    for (const error of errors ?? []) {
      if (!(error.code in next)) {
        issues.push({
          path: `${path}.${error.code}`,
          message: `declared error "${error.code}" has no next entry`,
        });
      }
    }
    return;
  }

  for (const target of allNextTargets(next)) {
    if (!ids.has(target)) {
      issues.push({ path, message: `target ${targetKind} "${target}" does not exist` });
    }
  }
}

export function entryPlanNodeIds(plan: PlanDefinition): string[] {
  const { backEdges, edgeKey } = findBackEdges(plan.nodes);
  const incoming = new Set<string>();

  for (const node of plan.nodes) {
    for (const target of allNextTargets(node.next)) {
      if (!backEdges.has(edgeKey(node.id, target))) {
        incoming.add(target);
      }
    }
  }

  return plan.nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id);
}

function findBackEdges(
  nodes: { id: string; next?: Next }[],
): { backEdges: Set<string>; edgeKey: (from: string, to: string) => string } {
  const edgeKey = (from: string, to: string) => `${from}\0${to}`;
  const adjacency = new Map(nodes.map((node) => [node.id, allNextTargets(node.next)]));
  const state = new Map<string, 'visiting' | 'done'>();
  const backEdges = new Set<string>();

  const visit = (id: string): void => {
    state.set(id, 'visiting');
    for (const target of adjacency.get(id) ?? []) {
      const targetState = state.get(target);
      if (targetState === 'visiting') {
        backEdges.add(edgeKey(id, target));
      } else if (targetState === undefined) {
        visit(target);
      }
    }
    state.set(id, 'done');
  };

  for (const node of nodes) {
    if (!state.has(node.id)) {
      visit(node.id);
    }
  }

  return { backEdges, edgeKey };
}
