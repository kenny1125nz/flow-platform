import { Graph, layout } from '@dagrejs/dagre';
import { TIER_ORDER, type FlowDefinition, type FlowNode, type Next, type PlanDefinition, type Stage, type TierKind } from '@shared/model';

export type DiagramNodeKind = 'human' | 'agent' | 'script' | 'flow';

export type DiagramNode = {
  id: string;
  label: string;
  sublabel: string;
  kind: DiagramNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  labelX?: number;
  labelY?: number;
  points: { x: number; y: number }[];
};

export type DiagramStage = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  nodeCount: number;
  depth: number;
};

export type DiagramLayout = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  stages: DiagramStage[];
  width: number;
  height: number;
};

type RawEdge = {
  from: string;
  to: string;
  label?: string;
};

type StageTree = {
  key: string;
  label: string;
  depth: number;
  nodes: FlowNode[];
  children: StageTree[];
  nodeCount: number;
};

type VisibleNode = {
  node: FlowNode;
  groupId: string;
};

type StageInfo = {
  key: string;
  label: string;
  depth: number;
  nodeCount: number;
  collapsed: boolean;
  parentKey?: string;
};

type LaidOutEdge = {
  v: string;
  w: string;
  name: string;
  label?: string;
  id: string;
};

const FLOW_NODE = { width: 140, height: 46 };
const PLAN_NODE = { width: 160, height: 50 };
const COLLAPSED_STAGE = { width: 180, height: 64 };
const EMPTY_STAGE = { width: 180, height: 50 };
const STAGE_PREFIX = '__stage__:';

export function layoutFlowDefinition(
  definition: FlowDefinition,
  collapsedKeys: ReadonlySet<string> = new Set(),
): DiagramLayout {
  const tree = buildStageTree(definition.stages, '', 0);
  const allNodes = collectTreeNodes(tree);

  const graph = new Graph({ multigraph: true, compound: true, directed: true });
  graph.setGraph({
    rankdir: 'TB',
    nodesep: 24,
    ranksep: 44,
    marginx: 8,
    marginy: 8,
    compound: true,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const visibleNodes: VisibleNode[] = [];
  const stageInfos: StageInfo[] = [];
  const nodeEndpoint = new Map<string, string>();

  const walk = (stage: StageTree, parentGroup?: string): void => {
    const groupId = groupIdOf(stage.key);
    const collapsed = collapsedKeys.has(stage.key);

    stageInfos.push({
      key: stage.key,
      label: stage.label,
      depth: stage.depth,
      nodeCount: stage.nodeCount,
      collapsed,
      ...(parentGroup === undefined ? {} : { parentKey: parentGroup }),
    });

    if (collapsed) {
      for (const id of collectSubtreeNodeIds(stage)) {
        nodeEndpoint.set(id, groupId);
      }
      graph.setNode(groupId, { label: stage.label, ...COLLAPSED_STAGE });
      if (parentGroup) {
        graph.setParent(groupId, parentGroup);
      }
      return;
    }

    if (stage.nodeCount === 0) {
      graph.setNode(groupId, { label: stage.label, ...EMPTY_STAGE });
    } else {
      graph.setNode(groupId, { label: stage.label });
    }
    if (parentGroup) {
      graph.setParent(groupId, parentGroup);
    }

    for (const node of stage.nodes) {
      nodeEndpoint.set(node.id, node.id);
      visibleNodes.push({ node, groupId });
    }

    for (const child of stage.children) {
      walk(child, groupId);
    }
  };

  for (const stage of tree) {
    walk(stage);
  }

  for (const { node, groupId } of visibleNodes) {
    graph.setNode(node.id, { ...FLOW_NODE });
    graph.setParent(node.id, groupId);
  }

  const edgeKeys: LaidOutEdge[] = [];
  const seenEdges = new Set<string>();

  for (const node of allNodes) {
    for (const raw of edgesFromNext(node.id, node.next)) {
      const from = nodeEndpoint.get(raw.from) ?? raw.from;
      const to = nodeEndpoint.get(raw.to) ?? raw.to;
      if (from === to) {
        continue;
      }
      const dedupeKey = `${from}|${to}|${raw.label ?? ''}`;
      if (seenEdges.has(dedupeKey)) {
        continue;
      }
      seenEdges.add(dedupeKey);

      const name = `${edgeKeys.length}`;
      const labelWidth = raw.label ? raw.label.length * 7 + 10 : 0;
      graph.setEdge(
        from,
        to,
        { label: raw.label, width: labelWidth, height: raw.label ? 18 : 0 },
        name,
      );
      edgeKeys.push({
        v: from,
        w: to,
        name,
        id: name,
        ...(raw.label === undefined ? {} : { label: raw.label }),
      });
    }
  }

  layout(graph);

  const graphLabel = graph.graph();
  const nodes: DiagramNode[] = visibleNodes.map(({ node }) => {
    const laidOut = graph.node(node.id);
    return {
      id: node.id,
      label: truncate(node.id, 18),
      sublabel: nodeTierLabel(node),
      kind: nodeKindOf(node),
      x: (laidOut.x ?? 0) - FLOW_NODE.width / 2,
      y: (laidOut.y ?? 0) - FLOW_NODE.height / 2,
      ...FLOW_NODE,
    };
  });

  const stages: DiagramStage[] = stageInfos
    .map((info) => {
      const laidOut = graph.node(groupIdOf(info.key));
      const width = laidOut.width ?? 0;
      const height = laidOut.height ?? 0;
      return {
        id: info.key,
        label: info.label,
        x: (laidOut.x ?? 0) - width / 2,
        y: (laidOut.y ?? 0) - height / 2,
        width,
        height,
        collapsed: info.collapsed,
        nodeCount: info.nodeCount,
        depth: info.depth,
      };
    })
    .sort((a, b) => a.depth - b.depth);

  return {
    nodes,
    edges: extractEdges(graph, edgeKeys),
    stages,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

export function layoutPlanDefinition(definition: PlanDefinition): DiagramLayout {
  const rawEdges = definition.nodes.flatMap((node) => edgesFromNext(node.id, node.next));

  return layoutFlatGraph(
    definition.nodes.map((node) => ({
      id: node.id,
      label: truncate(node.id, 20),
      sublabel: truncate(`${node.flow.id}@${node.flow.version}`, 28),
      kind: 'flow' as const,
      ...PLAN_NODE,
    })),
    rawEdges,
  );
}

function layoutFlatGraph(
  nodes: { id: string; label: string; sublabel: string; kind: DiagramNodeKind; width: number; height: number }[],
  rawEdges: RawEdge[],
): DiagramLayout {
  const graph = new Graph({ multigraph: true, directed: true });
  graph.setGraph({
    rankdir: 'TB',
    nodesep: 22,
    ranksep: 44,
    marginx: 8,
    marginy: 8,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, { width: node.width, height: node.height });
  }

  const edgeKeys: LaidOutEdge[] = [];
  rawEdges.forEach((edge, index) => {
    const name = `${index}`;
    const labelWidth = edge.label ? edge.label.length * 7 + 10 : 0;
    graph.setEdge(
      edge.from,
      edge.to,
      { label: edge.label, width: labelWidth, height: edge.label ? 18 : 0 },
      name,
    );
    edgeKeys.push({
      v: edge.from,
      w: edge.to,
      name,
      id: name,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    });
  });

  layout(graph);

  const graphLabel = graph.graph();
  const laidOutNodes: DiagramNode[] = nodes.map((node) => {
    const laidOut = graph.node(node.id);
    return {
      ...node,
      x: (laidOut.x ?? 0) - node.width / 2,
      y: (laidOut.y ?? 0) - node.height / 2,
    };
  });

  return {
    nodes: laidOutNodes,
    edges: extractEdges(graph, edgeKeys),
    stages: [],
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

function extractEdges(graph: Graph, edgeKeys: LaidOutEdge[]): DiagramEdge[] {
  return edgeKeys.flatMap((edge) => {
    const edgeLabel = graph.edge({ v: edge.v, w: edge.w, name: edge.name });
    const points: { x: number; y: number }[] = edgeLabel.points ?? [];
    if (points.length === 0) {
      return [];
    }
    return [
      {
        id: edge.id,
        from: edge.v,
        to: edge.w,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edgeLabel.x === undefined ? {} : { labelX: edgeLabel.x }),
        ...(edgeLabel.y === undefined ? {} : { labelY: edgeLabel.y }),
        points: points.map((point) => ({ x: point.x, y: point.y })),
      },
    ];
  });
}

function buildStageTree(stages: Stage[], parentKey: string, depth: number): StageTree[] {
  return stages.map((stage) => {
    const key = parentKey ? `${parentKey}/${stage.id}` : stage.id;
    const children = buildStageTree(stage.substages ?? [], key, depth + 1);
    return {
      key,
      label: stage.name ?? stage.id,
      depth,
      nodes: stage.nodes,
      children,
      nodeCount: stage.nodes.length + children.reduce((count, child) => count + child.nodeCount, 0),
    };
  });
}

function collectTreeNodes(tree: StageTree[]): FlowNode[] {
  return tree.flatMap((stage) => [...stage.nodes, ...collectTreeNodes(stage.children)]);
}

function collectSubtreeNodeIds(stage: StageTree): string[] {
  return [
    ...stage.nodes.map((node) => node.id),
    ...stage.children.flatMap((child) => collectSubtreeNodeIds(child)),
  ];
}

function groupIdOf(key: string): string {
  return `${STAGE_PREFIX}${key}`;
}

// The diagram's visual kind is the first (cheapest) tier of the node's stack; the
// sublabel shows the whole stack so joint-effort nodes are explicit.
function nodeKindOf(node: FlowNode): DiagramNodeKind {
  return node.tiers[0]?.kind ?? 'flow';
}

function nodeTierLabel(node: FlowNode): string {
  const kinds = node.tiers
    .map((tier) => tier.kind)
    .sort((a, b) => TIER_ORDER.indexOf(a as TierKind) - TIER_ORDER.indexOf(b as TierKind));
  return kinds.join('→');
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function edgesFromNext(from: string, next: Next | undefined): RawEdge[] {
  if (next === undefined) {
    return [];
  }
  if (typeof next === 'string') {
    return [{ from, to: next }];
  }
  if (Array.isArray(next)) {
    return next.map((to) => ({ from, to }));
  }
  return Object.entries(next).flatMap(([label, value]) =>
    (Array.isArray(value) ? value : [value]).map((to) => ({ from, to, label })),
  );
}
