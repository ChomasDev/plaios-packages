import type { MemoryQuery } from "@plaios/core/domain";
import {
  cosine,
  lexicalScores,
  normalizedTokens,
  searchTerms,
  searchableText,
  termWeights,
} from "./graph-values.js";
import type { RankedNode, StoredNode } from "./internal-types.js";
import type { ResolvedGraphOptions } from "./options.js";
import { GraphStore } from "./graph-store.js";

interface VectorCandidates {
  nodes: readonly StoredNode[];
  scores: Map<string, number>;
}

interface HybridCandidate {
  node: StoredNode;
  vectorScore: number;
  lexical: number;
  exact: number;
  importance: number;
}

export class CandidateSelector {
  constructor(
    private readonly store: GraphStore,
    private readonly options: ResolvedGraphOptions,
    private readonly weight: (node: StoredNode, at: Date) => number,
  ) {}

  async withoutText(
    query: MemoryQuery,
    limit: number,
  ): Promise<RankedNode[]> {
    const candidateLimit = Math.min(this.options.fallbackScanLimit, limit * 4);
    const now = this.options.clock();
    const nodes = await this.store.candidateNodes(query, candidateLimit);
    return nodes
      .filter((node) => this.matches(node, query, now))
      .map((node) => ({
        node,
        score: weightScore(this.weight(node, now)),
        depth: 0,
      }))
      .sort((left, right) => query.order === "newest"
        ? right.node.createdAt.getTime() - left.node.createdAt.getTime()
        : left.node.createdAt.getTime() - right.node.createdAt.getTime())
      .slice(0, limit);
  }

  async seeds(
    text: string,
    vector: readonly number[],
    query: MemoryQuery,
    limit: number,
  ): Promise<RankedNode[]> {
    const candidates = await this.vectorCandidates(vector, query, limit);
    const now = this.options.clock();
    const terms = searchTerms(text);
    const matching = candidates.nodes
      .filter((node) => this.matches(node, query, now))
      .map((node) => ({
        node,
        tokens: normalizedTokens(searchableText(node.type, node.label, node.data)),
        tags: normalizedTokens(JSON.stringify(node.metadata ?? {})),
      }));
    const weights = termWeights(terms, matching.map(({ tokens, tags }) => new Set([...tokens, ...tags])));
    const scored = matching
      .map(({ node, tokens, tags }) =>
        this.score(node, terms, tokens, tags, weights, vector, candidates.scores, now))
      .filter(({ exact, lexical, vectorScore }) =>
        exact > 0 || lexical > 0 ||
        vectorScore >= this.options.minimumVectorSimilarity);

    return fuseHybridChannels(scored, this.options.minimumVectorSimilarity, this.options.vectorChannelWeight)
      .slice(0, Math.max(this.options.seedLimit, limit))
      .map(({ node, score }) => ({ node, score, depth: 0 }));
  }

  matches(node: StoredNode, query: MemoryQuery, now: Date): boolean {
    if (query.userId !== undefined && node.userId !== query.userId) return false;
    // A text search ranks the scene-sized chunks of a long memory, not its whole text.
    if (query.text?.trim() && isChunkedParent(node)) return false;
    if (query.sessionId !== undefined && node.sessionId !== query.sessionId) {
      return false;
    }
    if (query.kinds?.length && !query.kinds.includes(node.kind ?? "semantic")) {
      return false;
    }
    if (query.minImportance !== undefined
      && this.weight(node, now) < query.minImportance) return false;
    if (!query.metadata) return true;

    const metadata = node.entry?.metadata ?? node.metadata;
    return Object.entries(query.metadata).every(
      ([key, value]) => metadata?.[key] === value,
    );
  }

  private score(
    node: StoredNode,
    terms: readonly string[],
    tokens: readonly string[],
    tags: readonly string[],
    weights: ReadonlyMap<string, number>,
    vector: readonly number[],
    vectorScores: ReadonlyMap<string, number>,
    now: Date,
  ) {
    const vectorScore = vectorScores.get(node.id) ?? cosine(vector, node.embedding);
    const { exact, lexical } = lexicalScores(terms, tokens, weights, tags);
    const importance = weightScore(this.weight(node, now));
    return { node, vectorScore, lexical, exact, importance };
  }

  private async vectorCandidates(
    vector: readonly number[],
    query: MemoryQuery,
    limit: number,
  ): Promise<VectorCandidates> {
    const filter: Record<string, unknown> = {};
    if (query.userId !== undefined) filter.userId = query.userId;
    if (query.sessionId !== undefined) filter.sessionId = query.sessionId;
    const vectorLimit = Math.max(
      this.options.seedLimit,
      Math.min(limit * 4, this.options.maxTraversalNodes),
    );
    const matches = await this.store.vectorQuery(vector, vectorLimit, filter);
    if (!matches) {
      return {
        nodes: await this.store.candidateNodes(query, this.options.fallbackScanLimit),
        scores: new Map(),
      };
    }
    const nodes = await Promise.all(matches.map(({ id }) => this.store.node(id)));
    return {
      nodes: nodes.filter((node): node is StoredNode => node !== undefined),
      scores: new Map(matches.map((match) => [match.id, match.score])),
    };
  }
}

/**
 * AURA-style deterministic fusion: exact, lexical, and vector searches rank
 * independently, then reciprocal-rank fusion rewards nodes found by multiple
 * channels. This prevents a noisy hash-vector match from hiding an exact name.
 * Each vote is scaled by its score relative to the channel's best, so matching
 * two of three terms outweighs matching one, and importance only breaks ties: repeated recalls
 * inflate the weight of old memories and must not outrank better matches.
 */
function fuseHybridChannels(
  candidates: readonly HybridCandidate[],
  minimumVectorSimilarity: number,
  vectorWeight: number,
): Array<{ node: StoredNode; score: number }> {
  const scores = new Map<string, number>();
  const hits = new Map<string, number>();
  const byId = new Map(candidates.map((candidate) => [candidate.node.id, candidate]));

  addChannel(candidates.filter(({ exact }) => exact > 0), ({ exact }) => exact, 1.4);
  addChannel(candidates.filter(({ lexical }) => lexical > 0), ({ lexical }) => lexical, 1);
  addChannel(
    candidates.filter(({ vectorScore }) => vectorScore >= minimumVectorSimilarity),
    ({ vectorScore }) => vectorScore,
    vectorWeight,
  );

  return [...scores.entries()]
    .map(([id, fused]) => {
      const candidate = byId.get(id)!;
      const hitBoost = 1 + Math.min((hits.get(id) ?? 1) - 1, 4) * 0.05;
      return {
        node: candidate.node,
        score: fused * hitBoost + candidate.importance * IMPORTANCE_TIE_BREAK,
      };
    })
    .sort((left, right) => right.score - left.score
      || right.node.weight - left.node.weight);

  function addChannel(
    channel: readonly HybridCandidate[],
    value: (candidate: HybridCandidate) => number,
    weight: number,
  ): void {
    const ranked = [...channel].sort((left, right) => value(right) - value(left));
    const best = ranked.length > 0 ? value(ranked[0]!) : 0;
    ranked.forEach((candidate, index) => {
      const id = candidate.node.id;
      const relative = best > 0 ? value(candidate) / best : 0;
      scores.set(id, (scores.get(id) ?? 0) + weight * relative / (60 + index + 1));
      hits.set(id, (hits.get(id) ?? 0) + 1);
    });
  }
}

const IMPORTANCE_TIE_BREAK = 0.0001;

function isChunkedParent(node: StoredNode): boolean {
  const metadata = node.entry?.metadata ?? node.metadata;
  return Number(metadata?.chunkCount) > 0 && metadata?.chunkOf === undefined;
}

function weightScore(weight: number): number {
  return weight / (1 + weight);
}
