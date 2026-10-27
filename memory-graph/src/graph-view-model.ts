import { MultiGraph } from "graphology";

export interface GraphNodeDto {
  id: string;
  type: string;
  label: string;
  kind?: string;
  weight: number;
  userId?: string;
  sessionId?: string;
  createdAt?: string;
  addedMemoryDate?: string;
  factDate?: string;
}

export interface GraphEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  weight: number;
}

export interface ThreeGraphNode extends GraphNodeDto {
  color: string;
  searchable: string;
  val: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface ThreeGraphLink {
  id: string;
  source: string | ThreeGraphNode;
  target: string | ThreeGraphNode;
  type: string;
  weight: number;
}

export interface ThreeGraphData {
  nodes: ThreeGraphNode[];
  links: ThreeGraphLink[];
}

export interface GraphData {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  available: boolean;
  totalNodes: number;
  totalEdges: number;
  nodeLimit: number;
  actions?: {
    refresh: () => Promise<GraphData>;
    forget: (id: string) => Promise<GraphData>;
    clear: () => Promise<GraphData>;
    remember: (input: { content: string; userId?: string }) => Promise<GraphData>;
  };
}

export interface MemoryNodeAttributes {
  color: string;
  fullLabel: string;
  highlighted?: boolean;
  label: string;
  searchable: string;
  size: number;
  nodeType: string;
  x: number;
  y: number;
}

export interface MemoryEdgeAttributes {
  color: string;
  label: string;
  size: number;
  weight: number;
}

export type MemoryGraph = MultiGraph<
  MemoryNodeAttributes,
  MemoryEdgeAttributes
>;

const TYPE_COLORS: Record<string, string> = {
  memory: "#64748b",
  people: "#f97316",
  project: "#a855f7",
  event: "#3b82f6",
  topic: "#06b6d4",
  skill: "#22c55e",
  place: "#eab308",
  organization: "#ec4899",
  document: "#f8fafc",
  protocol: "#14b8a6",
};

export function buildGraph(
  nodes: readonly GraphNodeDto[],
  edges: readonly GraphEdgeDto[],
): MemoryGraph {
  const graph = new MultiGraph() as MemoryGraph;
  const radius = Math.max(20, Math.sqrt(nodes.length) * 5);
  for (const [index, node] of nodes.entries()) {
    const angle = index * 2.399963;
    const distance = radius * Math.sqrt((index + 1) / nodes.length);
    graph.addNode(node.id, {
      color: colorFor(node.type),
      fullLabel: node.type === "memory" ? shorten(node.label, 64) : node.label,
      label: node.type === "memory" ? "" : node.label,
      searchable: searchableFor(node),
      size: sizeFor(node),
      nodeType: node.type,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    });
  }
  for (const edge of edges) {
    if (!graph.hasNode(edge.sourceId) || !graph.hasNode(edge.targetId))
      continue;
    graph.addEdgeWithKey(edge.id, edge.sourceId, edge.targetId, {
      color: "rgba(100, 116, 139, 0.62)",
      label: edge.type,
      size: Math.max(0.65, Math.min(1.4, edge.weight * 0.9)),
      weight: Math.max(0.1, edge.weight),
    });
  }
  return graph;
}

export function buildThreeGraphData(
  nodes: readonly GraphNodeDto[],
  edges: readonly GraphEdgeDto[],
): ThreeGraphData {
  const nodeIds = new Set(nodes.map(({ id }) => id));
  return {
    nodes: nodes.map((node) => ({
      ...node,
      color: colorFor(node.type),
      searchable: searchableFor(node),
      val: Math.max(1, sizeFor(node) * 0.8),
    })),
    links: edges
      .filter(({ sourceId, targetId }) => nodeIds.has(sourceId) && nodeIds.has(targetId))
      .map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        type: edge.type,
        weight: edge.weight,
      })),
  };
}

function searchableFor(node: GraphNodeDto): string {
  return `${node.label} ${node.type} ${node.id} ${node.addedMemoryDate ?? ""} ${node.factDate ?? ""}`.toLowerCase();
}

function colorFor(type: string): string {
  if (TYPE_COLORS[type]) return TYPE_COLORS[type];
  let hash = 0;
  for (const character of type) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 55%)`;
}

function sizeFor(node: GraphNodeDto): number {
  if (node.type === "memory") {
    return Math.max(3, Math.min(6, 3 + node.weight * 0.25));
  }
  return Math.max(4, Math.min(12, 4 + Math.sqrt(node.weight) * 1.8));
}

function shorten(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}
