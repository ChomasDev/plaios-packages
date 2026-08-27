import type { Database } from "@agent-os/core/domain";
import type {
  EmbeddingProvider,
  EntityExtractor,
  VectorStore,
} from "./types.js";

const DAY = 86_400_000;

export interface GraphMemoryOptions {
  database: Database;
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
  entityExtractor?: EntityExtractor;
  /** Weight added whenever get/recall returns a node. */
  accessBoost?: number;
  /** Time for an unaccessed weight to halve. Defaults to 30 days. */
  halfLifeMs?: number;
  traversalDepth?: number;
  traversalDiscount?: number;
  seedLimit?: number;
  /** Maximum nodes scanned by the dependency-free vector fallback. */
  fallbackScanLimit?: number;
  /** Hard traversal budget protecting recall from high-degree or cyclic graphs. */
  maxTraversalNodes?: number;
  /** Maximum incident edges considered for each expanded node. */
  maxEdgesPerNode?: number;
  /** Minimum cosine score accepted as a vector seed. */
  minimumVectorSimilarity?: number;
  now?: () => Date;
}

export interface ResolvedGraphOptions {
  accessBoost: number;
  clock: () => Date;
  fallbackScanLimit: number;
  halfLifeMs: number;
  maxEdgesPerNode: number;
  maxTraversalNodes: number;
  minimumVectorSimilarity: number;
  seedLimit: number;
  traversalDepth: number;
  traversalDiscount: number;
}

export function resolveGraphOptions(
  options: GraphMemoryOptions,
): ResolvedGraphOptions {
  if (!options.database) {
    throw new Error("GraphMemory requires a scoped database");
  }

  return {
    accessBoost: nonNegative(options.accessBoost ?? 0.1, "accessBoost"),
    clock: options.now ?? (() => new Date()),
    fallbackScanLimit: positiveInteger(
      options.fallbackScanLimit ?? 5_000,
      "fallbackScanLimit",
    ),
    halfLifeMs: positive(options.halfLifeMs ?? 30 * DAY, "halfLifeMs"),
    maxEdgesPerNode: positiveInteger(
      options.maxEdgesPerNode ?? 100,
      "maxEdgesPerNode",
    ),
    maxTraversalNodes: positiveInteger(
      options.maxTraversalNodes ?? 250,
      "maxTraversalNodes",
    ),
    minimumVectorSimilarity: bounded(
      options.minimumVectorSimilarity ?? 0.12,
      "minimumVectorSimilarity",
    ),
    seedLimit: Math.max(1, Math.floor(options.seedLimit ?? 24)),
    traversalDepth: Math.max(0, Math.floor(options.traversalDepth ?? 2)),
    traversalDiscount: bounded(
      options.traversalDiscount ?? 0.72,
      "traversalDiscount",
    ),
  };
}

export function nonNegative(value: number, name: string): number {
  if (Number.isFinite(value) && value >= 0) return value;
  throw new Error(`${name} must be a finite number >= 0`);
}

function positive(value: number, name: string): number {
  if (Number.isFinite(value) && value > 0) return value;
  throw new Error(`${name} must be a finite number > 0`);
}

function positiveInteger(value: number, name: string): number {
  if (Number.isInteger(value) && value > 0) return value;
  throw new Error(`${name} must be an integer > 0`);
}

export function bounded(value: number, name: string): number {
  if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  throw new Error(`${name} must be between 0 and 1`);
}
