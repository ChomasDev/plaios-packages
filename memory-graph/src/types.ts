import type { MemoryEntry, MemoryKind } from "@plaios/core/domain";

/** Built-in graph concepts. Custom string types are also accepted by GraphMemory. */
export enum MemoryNodeType {
  Memory = "memory",
  Person = "people",
  Hobby = "hobby",
  Place = "place",
  Organization = "organization",
  Event = "event",
  Topic = "topic",
  Preference = "preference",
  Skill = "skill",
  Project = "project",
  Protocol = "protocol",
}

export type NodeType = MemoryNodeType | (string & {});

export enum MemoryEdgeType {
  Mentions = "mentions",
  RelatedTo = "related-to",
  Knows = "knows",
  HasHobby = "has-hobby",
  LocatedAt = "located-at",
  MemberOf = "member-of",
  ParticipatedIn = "participated-in",
}

export type EdgeType = MemoryEdgeType | (string & {});

export interface GraphNode<T = Readonly<Record<string, unknown>>> {
  id: string;
  type: NodeType;
  label: string;
  data: T;
  metadata?: Readonly<Record<string, unknown>>;
  userId?: string;
  sessionId?: string;
  kind?: MemoryKind;
  weight?: number;
  createdAt?: Date;
  addedMemoryDate?: Date;
  factDate?: Date;
}

export interface GraphEdge {
  id?: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight?: number;
  metadata?: Readonly<Record<string, unknown>>;
  createdAt?: Date;
}

export interface EntityMention {
  type: NodeType;
  name: string;
  data?: Readonly<Record<string, unknown>>;
  relation?: EdgeType;
  relatedTo?: string;
}

export interface EntityExtractor {
  extract(entry: MemoryEntry): Promise<readonly EntityMention[]>;
}

export interface EmbeddingProvider {
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface VectorMatch { id: string; score: number }

/** Adapter for pgvector, Qdrant, Pinecone, or another external vector index. */
export interface VectorStore {
  upsert(id: string, vector: readonly number[], metadata?: Readonly<Record<string, unknown>>): Promise<void>;
  query(vector: readonly number[], limit: number, filter?: Readonly<Record<string, unknown>>): Promise<readonly VectorMatch[]>;
  remove(id: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface GraphRecallMetadata {
  graphNodeType: NodeType;
  graphScore: number;
  graphDepth: number;
  graphWeight: number;
  graphAccessCount: number;
  graphRelatedVia?: { nodeId: string; edgeType: EdgeType };
}
