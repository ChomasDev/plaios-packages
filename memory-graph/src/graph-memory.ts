import type {
  Memory,
  MemoryEntry,
  MemoryQuery,
} from "@agent-os/core/domain";
import { randomUUID } from "node:crypto";
import { DefaultEntityExtractor } from "./entity-extractor.js";
import { GraphNavigator } from "./graph-navigator.js";
import { GraphRetriever } from "./graph-retriever.js";
import { GraphStore } from "./graph-store.js";
import { GraphWriter } from "./graph-writer.js";
import { HashEmbeddingProvider } from "./hash-embedding.js";
import { toMemoryEntry } from "./node-mapper.js";
import {
  resolveGraphOptions,
  type GraphMemoryOptions,
  type ResolvedGraphOptions,
} from "./options.js";
import type { GraphData } from "./graph-view-model.js";
import type { GraphEdge, GraphNode } from "./types.js";

/**
 * Weighted property-graph memory. This facade preserves the generic Memory
 * contract while delegating storage, retrieval, and writes to focused modules.
 */
export class GraphMemory implements Memory {
  private readonly config: ResolvedGraphOptions;
  private readonly navigator: GraphNavigator;
  private readonly ready: Promise<void>;
  private readonly retriever: GraphRetriever;
  private readonly store: GraphStore;
  private readonly writer: GraphWriter;

  constructor(options: GraphMemoryOptions) {
    this.config = resolveGraphOptions(options);
    const embedder = options.embeddingProvider ?? new HashEmbeddingProvider();
    const extractor = options.entityExtractor ?? new DefaultEntityExtractor();
    this.store = new GraphStore(
      options.database,
      options.vectorStore,
      this.config.maxEdgesPerNode,
    );
    this.retriever = new GraphRetriever(this.store, embedder, this.config);
    this.writer = new GraphWriter(
      this.store,
      this.retriever,
      embedder,
      extractor,
      this.config.clock,
    );
    this.navigator = new GraphNavigator(
      this.store,
      this.retriever,
      this.config.maxTraversalNodes,
      this.config.clock,
    );
    this.ready = this.store.initialize();
  }

  async remember(entry: MemoryEntry): Promise<void> {
    await this.ready;
    await this.writer.remember(entry);
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    await this.ready;
    const node = await this.store.node(id);
    if (!node) return undefined;

    const now = this.config.clock();
    const entry = toMemoryEntry(
      { node, score: 1, depth: 0 },
      this.retriever.weight(node, now),
    );
    await this.retriever.reinforce([node]);
    return entry;
  }

  async recall(query: MemoryQuery = {}): Promise<readonly MemoryEntry[]> {
    await this.ready;
    const ranked = await this.retriever.discover(query);
    await this.retriever.reinforce(ranked.map(({ node }) => node));
    const now = this.config.clock();
    return ranked.map((item) =>
      toMemoryEntry(item, this.retriever.weight(item.node, now)));
  }

  async forget(id: string): Promise<boolean> {
    await this.ready;
    if (!await this.store.node(id)) return false;
    return this.store.removeNode(id);
  }

  async clear(query: MemoryQuery = {}): Promise<number> {
    await this.ready;
    if (Object.keys(query).length === 0) return this.store.clear();

    const ranked = await this.retriever.discover(
      { ...query, limit: Number.MAX_SAFE_INTEGER },
      false,
    );
    const roots = ranked.filter(({ depth }) => depth === 0);
    const removed = await Promise.all(
      roots.map(({ node }) => this.store.removeNode(node.id)),
    );
    return removed.filter(Boolean).length;
  }

  async upsertNode(input: GraphNode): Promise<GraphNode> {
    await this.ready;
    return this.writer.upsertNode(input);
  }

  async link(edge: GraphEdge): Promise<GraphEdge> {
    await this.ready;
    return this.writer.link(edge);
  }

  async neighbors(
    id: string,
    depth = 1,
  ): Promise<readonly GraphNode[]> {
    await this.ready;
    return this.navigator.neighbors(id, depth);
  }

  async microfrontendData(): Promise<GraphData> {
    const snapshot = await this.graphSnapshot();
    return {
      ...snapshot,
      actions: {
        refresh: () => this.graphSnapshot(),
        forget: async (id) => {
          await this.forget(id);
          return this.graphSnapshot();
        },
        clear: async () => {
          await this.clear();
          return this.graphSnapshot();
        },
        remember: async ({ content, userId }) => {
          const normalized = content.trim();
          if (!normalized) throw new Error("Memory content is required");
          await this.remember({
            id: `memory-${randomUUID()}`,
            kind: "semantic",
            content: normalized,
            createdAt: this.config.clock(),
            ...(userId?.trim() ? { userId: userId.trim() } : {}),
          });
          return this.graphSnapshot();
        },
      },
    };
  }

  private async graphSnapshot(): Promise<GraphData> {
    await this.ready;
    const [storedNodes, storedEdges] = await Promise.all([
      this.store.nodes(),
      this.store.edges(),
    ]);
    const nodeLimit = 2_000;
    const nodes = storedNodes
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, nodeLimit)
      .map((node) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        kind: node.kind ?? undefined,
        weight: this.retriever.weight(node, this.config.clock()),
        userId: node.userId ?? undefined,
        sessionId: node.sessionId ?? undefined,
        createdAt: node.createdAt.toISOString(),
        addedMemoryDate: (node.entry?.addedMemoryDate
          ? new Date(node.entry.addedMemoryDate)
          : node.createdAt).toISOString(),
        factDate: node.entry?.factDate
          ? new Date(node.entry.factDate).toISOString()
          : undefined,
      }));
    const visible = new Set(nodes.map(({ id }) => id));
    const edges = storedEdges
      .filter(({ sourceId, targetId }) => visible.has(sourceId) && visible.has(targetId))
      .slice(0, 5_000)
      .map(({ id, sourceId, targetId, type, weight }) => ({
        id,
        sourceId,
        targetId,
        type,
        weight,
      }));
    return {
      nodes,
      edges,
      available: true,
      totalNodes: storedNodes.length,
      totalEdges: storedEdges.length,
      nodeLimit,
    };
  }
}

export type { GraphMemoryOptions } from "./options.js";
