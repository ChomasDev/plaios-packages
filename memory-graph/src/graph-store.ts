import type { Database, MemoryQuery } from "@plaios/core/domain";
import {
  TABLES,
  type StoredDetail,
  type StoredEdge,
  type StoredNode,
} from "./internal-types.js";
import { createGraphSchema } from "./schema.js";
import type { VectorStore } from "./types.js";

export class GraphStore {
  constructor(
    private readonly database: Database,
    private readonly vectorStore: VectorStore | undefined,
    private readonly maxEdgesPerNode: number,
  ) {}

  initialize(): Promise<void> {
    return this.database.init(createGraphSchema());
  }

  node(id: string): Promise<StoredNode | undefined> {
    return this.database.get<StoredNode>(TABLES.nodes, id);
  }

  nodes(): Promise<readonly StoredNode[]> {
    return this.database.get<StoredNode>(TABLES.nodes, {});
  }

  candidateNodes(
    query: MemoryQuery,
    limit: number,
  ): Promise<readonly StoredNode[]> {
    const where: Record<string, unknown> = {};
    if (query.userId !== undefined) where.userId = query.userId;
    if (query.sessionId !== undefined) where.sessionId = query.sessionId;
    if (query.kinds?.length === 1) where.kind = query.kinds[0];

    return this.database.get<StoredNode>(TABLES.nodes, {
      where,
      orderBy: [{
        field: "createdAt",
        direction: query.order === "newest" ? "desc" : "asc",
      }],
      limit,
    });
  }

  edge(id: string): Promise<StoredEdge | undefined> {
    return this.database.get<StoredEdge>(TABLES.edges, id);
  }

  edges(): Promise<readonly StoredEdge[]> {
    return this.database.get<StoredEdge>(TABLES.edges, {});
  }

  async incidentEdges(nodeId: string): Promise<readonly StoredEdge[]> {
    const limit = this.maxEdgesPerNode;
    const [outgoing, incoming] = await Promise.all([
      this.database.get<StoredEdge>(TABLES.edges, {
        where: { sourceId: nodeId },
        limit,
      }),
      this.database.get<StoredEdge>(TABLES.edges, {
        where: { targetId: nodeId },
        limit,
      }),
    ]);
    const unique = new Map(
      [...outgoing, ...incoming].map((edge) => [edge.id, edge]),
    );
    return [...unique.values()].slice(0, limit);
  }

  async saveNode(node: StoredNode): Promise<void> {
    await this.database.set(TABLES.nodes, node.id, node);
    await this.vectorStore?.upsert(node.id, node.embedding, {
      type: node.type,
      userId: node.userId,
      sessionId: node.sessionId,
    });
  }

  async saveDetail(
    nodeId: string,
    type: string,
    data: Record<string, unknown>,
    updatedAt: Date,
  ): Promise<void> {
    const id = `${nodeId}:${type}`;
    const detail: StoredDetail = { id, nodeId, type, data, updatedAt };
    await this.database.set(TABLES.details, id, detail);
  }

  async saveEdge(edge: StoredEdge): Promise<void> {
    await this.database.set(TABLES.edges, edge.id, edge);
  }

  updateNode(id: string, patch: Partial<StoredNode>) {
    return this.database.update<StoredNode>(TABLES.nodes, id, patch);
  }

  async removeNode(id: string): Promise<boolean> {
    const edges = await this.incidentEdges(id);
    const details = await this.database.get<StoredDetail>(TABLES.details, {
      where: { nodeId: id },
    });
    await Promise.all([
      ...edges.map((edge) => this.database.delete(TABLES.edges, edge.id)),
      ...details.map((detail) => this.database.delete(TABLES.details, detail.id)),
    ]);
    await this.vectorStore?.remove(id);
    return (await this.database.delete(TABLES.nodes, id)) > 0;
  }

  async clear(): Promise<number> {
    const nodes = await this.nodes();
    await this.database.delete(TABLES.edges, {});
    await this.database.delete(TABLES.details, {});
    await this.database.delete(TABLES.nodes, {});

    const vectorStore = this.vectorStore;
    if (vectorStore?.clear) await vectorStore.clear();
    else if (vectorStore) {
      await Promise.all(nodes.map((node) => vectorStore.remove(node.id)));
    }
    return nodes.length;
  }

  /** Undefined when no vector store is configured. */
  vectorQuery(
    vector: readonly number[],
    limit: number,
    filter: Readonly<Record<string, unknown>>,
  ) {
    return this.vectorStore?.query(vector, limit, filter);
  }
}
