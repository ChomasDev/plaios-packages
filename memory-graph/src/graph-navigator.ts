import { adjacentNodeId, GraphRetriever } from "./graph-retriever.js";
import { GraphStore } from "./graph-store.js";
import { toGraphNode } from "./node-mapper.js";
import type { StoredNode } from "./internal-types.js";
import type { GraphNode } from "./types.js";

export class GraphNavigator {
  constructor(
    private readonly store: GraphStore,
    private readonly retriever: GraphRetriever,
    private readonly maxNodes: number,
    private readonly clock: () => Date,
  ) {}

  async neighbors(id: string, depth: number): Promise<readonly GraphNode[]> {
    const seen = new Set([id]);
    const found = new Map<string, StoredNode>();
    let frontier = [id];

    for (let level = 0; level < Math.max(0, depth); level += 1) {
      if (frontier.length === 0 || seen.size >= this.maxNodes) break;

      const next: string[] = [];
      for (const nodeId of frontier) {
        const edges = await this.store.incidentEdges(nodeId);
        for (const edge of edges) {
          const neighborId = adjacentNodeId(edge, nodeId);
          if (!neighborId || seen.has(neighborId)) continue;
          if (seen.size >= this.maxNodes) break;

          const node = await this.store.node(neighborId);
          if (!node) continue;
          seen.add(neighborId);
          found.set(neighborId, node);
          next.push(neighborId);
        }
      }
      frontier = next;
    }

    seen.delete(id);
    const now = this.clock();
    return [...seen]
      .map((nodeId) => found.get(nodeId))
      .filter((node): node is StoredNode => node !== undefined)
      .map((node) => toGraphNode(node, this.retriever.weight(node, now)));
  }
}
