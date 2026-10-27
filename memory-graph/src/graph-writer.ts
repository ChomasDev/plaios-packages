import type { MemoryEntry } from "@plaios/core/domain";
import {
  asRecord,
  cloneEntry,
  edgeId,
  entityId,
  isRecord,
  labelFor,
  searchableText,
} from "./graph-values.js";
import type { StoredEdge, StoredNode } from "./internal-types.js";
import { bounded, nonNegative } from "./options.js";
import { GraphRetriever } from "./graph-retriever.js";
import { GraphStore } from "./graph-store.js";
import {
  MemoryEdgeType,
  MemoryNodeType,
  type EdgeType,
  type EmbeddingProvider,
  type EntityExtractor,
  type EntityMention,
  type GraphEdge,
  type GraphNode,
} from "./types.js";
import { toGraphNode } from "./node-mapper.js";

export class GraphWriter {
  constructor(
    private readonly store: GraphStore,
    private readonly retriever: GraphRetriever,
    private readonly embedder: EmbeddingProvider,
    private readonly extractor: EntityExtractor,
    private readonly clock: () => Date,
  ) {}

  async remember(entry: MemoryEntry): Promise<void> {
    const now = this.clock();
    const current = await this.store.node(entry.id);
    const addedMemoryDate = current?.createdAt
      ?? entry.addedMemoryDate
      ?? entry.createdAt;
    const normalizedEntry = cloneEntry({ ...entry, addedMemoryDate });
    const [embedding = []] = await this.embedder.embed([
      searchableText(
        MemoryNodeType.Memory,
        String(entry.kind),
        entry.content,
        {
          ...entry.metadata,
          addedMemoryDate,
          factDate: entry.factDate,
        },
      ),
    ]);
    const node: StoredNode = {
      id: entry.id,
      type: MemoryNodeType.Memory,
      label: labelFor(entry.content),
      data: entry.content ?? null,
      entry: normalizedEntry,
      metadata: { ...entry.metadata },
      embedding: [...embedding],
      userId: entry.userId ?? null,
      sessionId: entry.sessionId ?? null,
      kind: entry.kind,
      weight: current
        ? this.retriever.weight(current, now)
        : nonNegative(entry.importance ?? 1, "importance"),
      accessCount: current?.accessCount ?? 0,
      createdAt: addedMemoryDate,
      updatedAt: now,
      lastAccessedAt: current?.lastAccessedAt ?? null,
      weightUpdatedAt: now,
    };
    await this.store.saveNode(node);
    await this.store.saveDetail(node.id, node.type, {
      ...entry.metadata,
      kind: entry.kind,
      content: entry.content,
      addedMemoryDate,
      factDate: entry.factDate,
    }, now);
    await this.rememberMentions(node, await this.extractor.extract(entry), now);
  }

  async upsertNode(input: GraphNode): Promise<GraphNode> {
    const now = this.clock();
    const id = input.id || entityId(input.type, input.label, input.userId);
    const current = await this.store.node(id);
    const data = mergeData(current?.data, input.data);
    const [embedding = []] = await this.embedder.embed([
      searchableText(input.type, input.label, data, input.metadata),
    ]);
    const stored: StoredNode = {
      id,
      type: input.type,
      label: input.label,
      data,
      entry: null,
      metadata: { ...current?.metadata, ...input.metadata },
      embedding: [...embedding],
      userId: input.userId ?? current?.userId ?? null,
      sessionId: input.sessionId ?? current?.sessionId ?? null,
      kind: input.kind ?? current?.kind ?? "semantic",
      weight: current
        ? this.retriever.weight(current, now)
        : nonNegative(input.weight ?? 1, "weight"),
      accessCount: current?.accessCount ?? 0,
      createdAt: current?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
      lastAccessedAt: current?.lastAccessedAt ?? null,
      weightUpdatedAt: now,
    };
    await this.store.saveNode(stored);
    await this.store.saveDetail(id, input.type, asRecord(data), now);
    return toGraphNode(stored, this.retriever.weight(stored, now));
  }

  async link(edge: GraphEdge): Promise<GraphEdge> {
    const [source, target] = await Promise.all([
      this.store.node(edge.sourceId),
      this.store.node(edge.targetId),
    ]);
    if (!source || !target) {
      throw new Error(
        `Cannot link missing graph nodes: ${edge.sourceId} -> ${edge.targetId}`,
      );
    }

    const now = this.clock();
    const id = edge.id ?? edgeId(edge.sourceId, edge.type, edge.targetId);
    const current = await this.store.edge(id);
    const stored: StoredEdge = {
      id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      weight: bounded(edge.weight ?? current?.weight ?? 1, "edge weight"),
      metadata: { ...current?.metadata, ...edge.metadata },
      createdAt: current?.createdAt ?? edge.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.saveEdge(stored);
    return { ...stored, type: stored.type as EdgeType };
  }

  private async rememberMentions(
    memory: StoredNode,
    mentions: readonly EntityMention[],
    now: Date,
  ): Promise<void> {
    const references = new Map<string, string>();
    for (const mention of mentions) {
      const id = entityId(
        mention.type,
        mention.name,
        memory.userId ?? memory.sessionId ?? undefined,
      );
      const node = await this.upsertNode({
        id,
        type: mention.type,
        label: mention.name,
        data: mention.data ?? {},
        userId: memory.userId ?? undefined,
        sessionId: memory.sessionId ?? undefined,
        kind: "semantic",
        createdAt: now,
      });
      references.set(referenceKey(mention.type, mention.name), node.id);
      await this.link({
        sourceId: memory.id,
        targetId: node.id,
        type: MemoryEdgeType.Mentions,
      });
    }
    for (const mention of mentions) {
      if (!mention.relatedTo) continue;
      const sourceId = references.get(mention.relatedTo.toLowerCase());
      const targetId = references.get(referenceKey(mention.type, mention.name));
      if (!sourceId || !targetId || sourceId === targetId) continue;
      await this.link({
        sourceId,
        targetId,
        type: mention.relation ?? MemoryEdgeType.RelatedTo,
      });
    }
  }
}

function mergeData(current: unknown, incoming: unknown): unknown {
  if (!isRecord(current) || !isRecord(incoming)) return incoming;
  return { ...current, ...incoming };
}

function referenceKey(type: string, name: string): string {
  return `${type}:${name}`.toLowerCase();
}
