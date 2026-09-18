import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Memory,
  MemoryEntry,
  MemoryKind,
} from "@agent-os/core/domain";

export interface MemoryRetrievalInput {
  query: string;
  limit: number | null;
  kinds: Array<"semantic" | "episodic" | "procedural"> | null;
}

export interface MemoryRetrievalResultItem {
  id: string;
  kind: MemoryKind;
  content: unknown;
  addedMemoryDate: string;
  factDate?: string;
  importance?: number;
  graphType?: unknown;
  graphScore?: unknown;
  graphDepth?: unknown;
  relatedVia?: unknown;
}

export interface MemoryRetrievalOutput {
  query: string;
  count: number;
  results: MemoryRetrievalResultItem[];
}

export interface MemoryRetrievalCapabilityOptions {
  memory: Memory;
  defaultLimit?: number;
  maxLimit?: number;
}

const durableKinds: readonly MemoryKind[] = [
  "semantic",
  "episodic",
  "procedural",
];

const manifest: CapabilityManifest = {
  id: "memory.retrieval",
  version: "1.0.0",
  name: "memory_retrieval",
  description:
    "Search persistent graph memory during the current response. Use focused follow-up queries when the initial context is incomplete, ambiguous, or needs more detail. You may call it multiple times with different queries before answering.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "A focused natural-language query for the missing information.",
      },
      limit: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 50,
        description: "Number of results, or null to use the configured default.",
      },
      kinds: {
        type: ["array", "null"],
        items: {
          type: "string",
          enum: durableKinds,
        },
        description: "Durable memory kinds to search, or null for all kinds.",
      },
    },
    required: ["query", "limit", "kinds"],
    additionalProperties: false,
  },
  permissions: ["memory.read"],
  tags: ["memory", "retrieval", "graph", "search"],
  execution: { timeoutMs: 10_000, idempotent: true },
  examples: [
    {
      request: "Find more details about Alessia and the third season",
      arguments: {
        query: "Alessia terza stagione eventi relazione",
        limit: 20,
        kinds: ["semantic", "episodic"],
      },
    },
  ],
};

export class MemoryRetrievalCapability
  implements Capability<MemoryRetrievalInput, MemoryRetrievalOutput>
{
  readonly manifest = manifest;

  private readonly memory: Memory;
  private readonly defaultLimit: number;
  private readonly maxLimit: number;

  constructor(options: MemoryRetrievalCapabilityOptions) {
    if (!options.memory) throw new Error("MemoryRetrievalCapability requires memory");
    this.memory = options.memory;
    this.maxLimit = normalizeLimit(options.maxLimit, 50, 100);
    this.defaultLimit = normalizeLimit(
      options.defaultLimit,
      20,
      this.maxLimit,
    );
  }

  microfrontendData() {
    return {
      provider: this.memory.constructor.name,
      defaultLimit: this.defaultLimit,
      maxLimit: this.maxLimit,
      durableKinds,
    };
  }

  async execute(
    input: MemoryRetrievalInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<MemoryRetrievalOutput>> {
    const query = input.query?.trim();
    if (!query) return failure("VALIDATION_ERROR", "Input 'query' is required");
    if (context.signal?.aborted) {
      return failure("RETRIEVAL_ABORTED", "Memory retrieval was aborted", true);
    }

    const limit = normalizeLimit(input.limit, this.defaultLimit, this.maxLimit);
    const kinds = normalizeKinds(input.kinds);

    try {
      const entries = await this.memory.recall({
        text: query,
        kinds,
        userId: context.userId,
        limit,
      });
      await linkResults(this.memory, entries, context, query);
      return {
        success: true,
        data: {
          query,
          count: entries.length,
          results: entries.map(toResultItem),
        },
      };
    } catch (error) {
      return failure(
        "MEMORY_RETRIEVAL_FAILED",
        error instanceof Error ? error.message : "Memory retrieval failed",
        true,
      );
    }
  }
}

function toResultItem(entry: MemoryEntry): MemoryRetrievalResultItem {
  return {
    id: entry.id,
    kind: entry.kind,
    content: entry.content,
    addedMemoryDate: toIsoDate(entry.addedMemoryDate ?? entry.createdAt),
    ...(entry.factDate ? { factDate: toIsoDate(entry.factDate) } : {}),
    importance: entry.importance,
    graphType: entry.metadata?.graphNodeType,
    graphScore: entry.metadata?.graphScore,
    graphDepth: entry.metadata?.graphDepth,
    relatedVia: entry.metadata?.graphRelatedVia,
  };
}

function toIsoDate(value: Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}

function normalizeLimit(
  value: number | null | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function normalizeKinds(
  kinds: MemoryRetrievalInput["kinds"],
): readonly MemoryKind[] {
  if (!kinds?.length) return durableKinds;
  return [...new Set(kinds)].filter((kind) => durableKinds.includes(kind));
}

interface LinkableMemory extends Memory {
  link(edge: {
    sourceId: string;
    targetId: string;
    type: string;
    metadata?: Readonly<Record<string, unknown>>;
  }): Promise<unknown>;
}

async function linkResults(
  memory: Memory,
  entries: readonly MemoryEntry[],
  context: CapabilityExecutionContext,
  query: string,
): Promise<void> {
  if (!isLinkableMemory(memory)) return;
  const inputMessageId = context.metadata?.inputMessageId;
  if (typeof inputMessageId !== "string" || !inputMessageId) return;

  await Promise.all(entries.map((entry, rank) => memory.link({
    sourceId: `chat-user-${inputMessageId}`,
    targetId: entry.id,
    type: "tool-retrieved-context",
    metadata: {
      callId: context.callId,
      query,
      rank,
      score: entry.metadata?.graphScore,
    },
  })));
}

function isLinkableMemory(memory: Memory): memory is LinkableMemory {
  return "link" in memory && typeof memory.link === "function";
}

function failure(
  code: string,
  message: string,
  retryable = false,
): CapabilityResult<never> {
  return {
    success: false,
    error: { code, message, retryable },
  };
}
