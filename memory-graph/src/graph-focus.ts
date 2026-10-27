import type { GraphEdgeDto, GraphNodeDto } from "./graph-view-model.js";

/** Picks the node the question is about: an exact label, then entities over raw memories, then the shortest label, then weight. */
export function bestMatch(nodes: GraphNodeDto[], focus: string): GraphNodeDto | undefined {
  const needle = focus.trim().toLowerCase();
  if (!needle) return undefined;
  const score = (node: GraphNodeDto) => { const label = node.label.toLowerCase(); return label === needle ? 3 : !label.includes(needle) ? 0 : node.type === "memory" ? 1 : 2; };
  return [...nodes].filter((node) => score(node) > 0).sort((a, b) => score(b) - score(a) || a.label.length - b.label.length || b.weight - a.weight)[0];
}

/** Nodes within `depth` hops of the center and the edges among them, capped so the preview stays light. */
export function neighborhood(nodes: GraphNodeDto[], edges: GraphEdgeDto[], centerId: string | undefined, depth: number, limit = 40) {
  if (!centerId) return { nodes: [], edges: [] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const keep = new Set([centerId]);
  let frontier = [centerId];
  for (let hop = 0; hop < depth && keep.size < limit; hop += 1) {
    const next: string[] = [];
    for (const edge of edges) {
      for (const [from, to] of [[edge.sourceId, edge.targetId], [edge.targetId, edge.sourceId]]) {
        if (frontier.includes(from) && !keep.has(to) && byId.has(to) && keep.size < limit) { keep.add(to); next.push(to); }
      }
    }
    frontier = next;
  }
  return { nodes: nodes.filter((node) => keep.has(node.id)), edges: edges.filter((edge) => keep.has(edge.sourceId) && keep.has(edge.targetId)) };
}

