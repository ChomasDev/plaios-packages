import type { MemoryQuery } from "@agent-os/core/domain";
import { CandidateSelector } from "./candidate-selector.js";
import type { RankedNode, StoredNode } from "./internal-types.js";
import { bounded, type ResolvedGraphOptions } from "./options.js";
import { GraphStore } from "./graph-store.js";
import type { EmbeddingProvider } from "./types.js";

export class GraphRetriever {
  private readonly candidates: CandidateSelector;

  constructor(
    private readonly store: GraphStore,
    private readonly embedder: EmbeddingProvider,
    private readonly options: ResolvedGraphOptions,
  ) {
    this.candidates = new CandidateSelector(
      store,
      options,
      (node, at) => this.weight(node, at),
    );
  }

  async discover(
    query: MemoryQuery,
    applyLimit = true,
  ): Promise<RankedNode[]> {
    const requestedLimit = Math.max(0, query.limit ?? 100);
    const limit = applyLimit
      ? requestedLimit
      : this.options.fallbackScanLimit;
    if (limit === 0) return [];

    const text = query.text?.trim();
    if (!text) return this.candidates.withoutText(query, limit);

    const [vector = []] = await this.embedder.embed([text]);
    const seeds = await this.candidates.seeds(text, vector, query, limit);
    const ranked = await this.traverse(seeds, query);
    return ranked.slice(0, limit);
  }

  async reinforce(nodes: readonly StoredNode[]): Promise<void> {
    if (this.options.accessBoost === 0 || nodes.length === 0) return;

    const now = this.options.clock();
    await Promise.all(nodes.map(async (candidate) => {
      const current = await this.store.node(candidate.id);
      if (!current) return;

      await this.store.updateNode(current.id, {
        weight: this.weight(current, now) + this.options.accessBoost,
        accessCount: current.accessCount + 1,
        lastAccessedAt: now,
        weightUpdatedAt: now,
        updatedAt: now,
      });
    }));
  }

  weight(node: StoredNode, at: Date): number {
    const elapsed = Math.max(0, at.getTime() - node.weightUpdatedAt.getTime());
    return node.weight * Math.pow(0.5, elapsed / this.options.halfLifeMs);
  }

  private async traverse(
    seeds: readonly RankedNode[],
    query: MemoryQuery,
  ): Promise<RankedNode[]> {
    const ranked = new Map(seeds.map((seed) => [seed.node.id, seed]));
    const nodes = new Map(seeds.map((seed) => [seed.node.id, seed.node]));
    const now = this.options.clock();
    let frontier = [...seeds];

    for (let depth = 1; depth <= this.options.traversalDepth; depth += 1) {
      if (frontier.length === 0) break;
      if (ranked.size >= this.options.maxTraversalNodes) break;

      const next = new Map<string, RankedNode>();
      for (const parent of frontier) {
        const edges = await this.store.incidentEdges(parent.node.id);
        const hubPenalty = 1 / Math.sqrt(Math.max(1, edges.length));
        for (const edge of edges) {
          const id = adjacentNodeId(edge, parent.node.id);
          if (!id) continue;

          const neighbor = nodes.get(id) ?? await this.store.node(id);
          if (!neighbor) continue;
          nodes.set(id, neighbor);
          if (!this.candidates.matches(neighbor, query, now)) continue;

          const score = parent.score
            * bounded(edge.weight, "stored edge weight")
            * this.options.traversalDiscount
            * hubPenalty;
          if ((ranked.get(id)?.score ?? -1) >= score) continue;

          const candidate: RankedNode = {
            node: neighbor,
            score,
            depth,
            relatedVia: { nodeId: parent.node.id, edgeType: edge.type },
          };
          ranked.set(id, candidate);
          next.set(id, candidate);
          if (ranked.size >= this.options.maxTraversalNodes) break;
        }
        if (ranked.size >= this.options.maxTraversalNodes) break;
      }
      frontier = [...next.values()];
    }

    return [...ranked.values()].sort(
      (left, right) => right.score - left.score
        || right.node.weight - left.node.weight,
    );
  }

}

function adjacentNodeId(
  edge: { sourceId: string; targetId: string },
  nodeId: string,
): string | undefined {
  if (edge.sourceId === nodeId) return edge.targetId;
  if (edge.targetId === nodeId) return edge.sourceId;
  return undefined;
}
