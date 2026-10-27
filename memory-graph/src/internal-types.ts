import type {
  DatabaseRecord,
  MemoryEntry,
  MemoryKind,
} from "@plaios/core/domain";
import type { EdgeType } from "./types.js";

export interface StoredNode extends DatabaseRecord {
  id: string;
  type: string;
  label: string;
  data: unknown;
  entry: MemoryEntry | null;
  metadata: Record<string, unknown>;
  embedding: number[];
  userId: string | null;
  sessionId: string | null;
  kind: MemoryKind | null;
  weight: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  weightUpdatedAt: Date;
}

export interface StoredDetail extends DatabaseRecord {
  id: string;
  nodeId: string;
  type: string;
  data: Record<string, unknown>;
  updatedAt: Date;
}

export interface StoredEdge extends DatabaseRecord {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RankedNode {
  node: StoredNode;
  score: number;
  depth: number;
  relatedVia?: {
    nodeId: string;
    edgeType: EdgeType;
  };
}

export const TABLES = {
  details: "node_details",
  edges: "edges",
  nodes: "nodes",
} as const;
