import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
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
import { toGraphNode, toMemoryEntry } from "./node-mapper.js";
import {
  resolveGraphOptions,
  type GraphMemoryOptions,
  type ResolvedGraphOptions,
} from "./options.js";
import type { GraphData } from "./graph-view-model.js";
import type { GraphEdge, GraphNode, NodeType } from "./types.js";

export interface GraphWriteInput {
  nodes: Array<{
    ref: string;
    type: string;
    label: string;
    attributes: Array<{ key: string; value: string }>;
    weight: number | null;
    factDate: string | null;
  }>;
  edges: Array<{
    sourceRef: string;
    targetRef: string;
    type: string;
    weight: number | null;
  }>;
}

export interface GraphWriteOutput {
  nodes: Array<{ ref: string; id: string; type: string; label: string }>;
  edges: Array<{ id?: string; sourceId: string; targetId: string; type: string }>;
}

const graphWriteManifest: CapabilityManifest = {
  id: "memory.graph.write",
  version: "1.0.0",
  name: "memory_graph_write",
  description:
    "Create or update durable graph-memory entities and explicit relationships. Use this whenever the user asks you to remember a person, place, event, topic, protocol, or how named entities are connected. Include every endpoint in nodes and refer to it from edges by ref. Reusing the same type and label updates the existing user-scoped node instead of duplicating it.",
  inputSchema: {
    type: "object",
    properties: {
      nodes: {
        type: "array",
        minItems: 1,
        maxItems: 25,
        items: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "Short unique reference used by edges in this call.",
            },
            type: {
              type: "string",
              description: "Entity type such as people, place, event, topic, project, organization, or protocol.",
            },
            label: { type: "string", description: "Canonical entity name." },
            attributes: {
              type: "array",
              maxItems: 25,
              description: "Durable key/value facts about the entity; use an empty array when none are needed.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                },
                required: ["key", "value"],
                additionalProperties: false,
              },
            },
            weight: {
              type: ["number", "null"],
              minimum: 0,
              description: "Optional importance weight, or null for the default.",
            },
            factDate: {
              type: ["string", "null"],
              description: "ISO-8601 date for when the fact was true, or null when unspecified.",
            },
          },
          required: ["ref", "type", "label", "attributes", "weight", "factDate"],
          additionalProperties: false,
        },
      },
      edges: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            sourceRef: { type: "string" },
            targetRef: { type: "string" },
            type: {
              type: "string",
              description: "Relationship such as knows, friend-of, participated-in, or related-to.",
            },
            weight: {
              type: ["number", "null"],
              minimum: 0,
              maximum: 1,
              description: "Optional relationship strength from 0 to 1, or null for the default.",
            },
          },
          required: ["sourceRef", "targetRef", "type", "weight"],
          additionalProperties: false,
        },
      },
    },
    required: ["nodes", "edges"],
    additionalProperties: false,
  },
  permissions: ["memory.write"],
  tags: ["memory", "graph", "write", "remember", "node", "relationship"],
  execution: { timeoutMs: 10_000, idempotent: true },
  examples: [
    {
      request: "Remember that Valentina is a friend of Alex, Martina, and Federico.",
      arguments: {
        nodes: [
          { ref: "valentina", type: "people", label: "Valentina", attributes: [], weight: null, factDate: null },
          { ref: "alex", type: "people", label: "Alex", attributes: [], weight: null, factDate: null },
          { ref: "martina", type: "people", label: "Martina", attributes: [], weight: null, factDate: null },
          { ref: "federico", type: "people", label: "Federico", attributes: [], weight: null, factDate: null },
        ],
        edges: [
          { sourceRef: "valentina", targetRef: "alex", type: "friend-of", weight: null },
          { sourceRef: "valentina", targetRef: "martina", type: "friend-of", weight: null },
          { sourceRef: "valentina", targetRef: "federico", type: "friend-of", weight: null },
        ],
      },
    },
  ],
};

/**
 * Weighted property-graph memory. This facade preserves the generic Memory
 * contract while delegating storage, retrieval, and writes to focused modules.
 */
export class GraphMemory implements Memory, Capability<GraphWriteInput, GraphWriteOutput> {
  readonly manifest = graphWriteManifest;
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

  async listNodes(query: { type?: NodeType; userId?: string } = {}): Promise<readonly GraphNode[]> {
    await this.ready;
    const now = this.config.clock();
    const nodes = await this.store.nodes();
    return nodes
      .filter((node) =>
        (!query.type || node.type === query.type) &&
        (!query.userId || node.userId === query.userId))
      .map((node) => toGraphNode(node, this.retriever.weight(node, now)));
  }

  async execute(
    input: GraphWriteInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<GraphWriteOutput>> {
    if (context.signal?.aborted) {
      return graphWriteFailure("GRAPH_WRITE_ABORTED", "Graph memory write was aborted", true);
    }
    if (!Array.isArray(input?.nodes) || input.nodes.length === 0 || input.nodes.length > 25) {
      return graphWriteFailure("VALIDATION_ERROR", "Input 'nodes' must contain between 1 and 25 nodes");
    }
    if (!Array.isArray(input.edges) || input.edges.length > 50) {
      return graphWriteFailure("VALIDATION_ERROR", "Input 'edges' must contain at most 50 relationships");
    }

    const refs = new Set<string>();
    for (const node of input.nodes) {
      const ref = node.ref?.trim();
      const type = node.type?.trim();
      const label = node.label?.trim();
      if (!ref || !type || !label) {
        return graphWriteFailure("VALIDATION_ERROR", "Every node requires a non-empty ref, type, and label");
      }
      if (refs.has(ref)) {
        return graphWriteFailure("VALIDATION_ERROR", `Duplicate node ref: ${ref}`);
      }
      refs.add(ref);
      if (!Array.isArray(node.attributes) || node.attributes.length > 25 || node.attributes.some(({ key, value }) => !key?.trim() || typeof value !== "string")) {
        return graphWriteFailure("VALIDATION_ERROR", `Node '${ref}' attributes must contain at most 25 non-empty string key/value pairs`);
      }
      if (node.factDate !== null && !validDate(node.factDate)) {
        return graphWriteFailure("VALIDATION_ERROR", `Node '${ref}' factDate must be a valid ISO-8601 date or null`);
      }
      if (node.weight !== null && (!Number.isFinite(node.weight) || node.weight < 0)) {
        return graphWriteFailure("VALIDATION_ERROR", `Node '${ref}' weight must be a non-negative number or null`);
      }
    }
    for (const edge of input.edges) {
      if (!refs.has(edge.sourceRef) || !refs.has(edge.targetRef)) {
        return graphWriteFailure("VALIDATION_ERROR", `Relationship endpoints must reference nodes in this call: ${edge.sourceRef} -> ${edge.targetRef}`);
      }
      if (!edge.type?.trim()) {
        return graphWriteFailure("VALIDATION_ERROR", "Every relationship requires a non-empty type");
      }
      if (edge.weight !== null && (!Number.isFinite(edge.weight) || edge.weight < 0 || edge.weight > 1)) {
        return graphWriteFailure("VALIDATION_ERROR", `Relationship weight must be between 0 and 1 or null: ${edge.sourceRef} -> ${edge.targetRef}`);
      }
    }

    try {
      const nodes: GraphWriteOutput["nodes"] = [];
      const ids = new Map<string, string>();
      for (const inputNode of input.nodes) {
        const ref = inputNode.ref.trim();
        const node = await this.upsertNode({
          id: "",
          type: inputNode.type.trim(),
          label: inputNode.label.trim(),
          data: Object.fromEntries(inputNode.attributes.map(({ key, value }) => [key.trim(), value])),
          ...(inputNode.weight === null ? {} : { weight: inputNode.weight }),
          ...(inputNode.factDate === null ? {} : { factDate: new Date(inputNode.factDate) }),
          ...(context.userId ? { userId: context.userId } : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
          kind: "semantic",
          metadata: {
            namespace: "user-memory",
            sourceChannel: context.metadata?.channel,
            sourceMessageId: context.metadata?.inputMessageId,
          },
        });
        ids.set(ref, node.id);
        nodes.push({ ref, id: node.id, type: node.type, label: node.label });
      }

      const edges: GraphWriteOutput["edges"] = [];
      for (const inputEdge of input.edges) {
        const edge = await this.link({
          sourceId: ids.get(inputEdge.sourceRef)!,
          targetId: ids.get(inputEdge.targetRef)!,
          type: inputEdge.type.trim(),
          ...(inputEdge.weight === null ? {} : { weight: inputEdge.weight }),
          metadata: {
            namespace: "user-memory",
            sourceChannel: context.metadata?.channel,
            sourceMessageId: context.metadata?.inputMessageId,
          },
        });
        edges.push({ id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, type: edge.type });
      }
      return { success: true, data: { nodes, edges } };
    } catch (error) {
      return graphWriteFailure(
        "GRAPH_WRITE_FAILED",
        error instanceof Error ? error.message : "Graph memory write failed",
        true,
      );
    }
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
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
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

function validDate(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function graphWriteFailure(
  code: string,
  message: string,
  retryable = false,
): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}

export type { GraphMemoryOptions } from "./options.js";
