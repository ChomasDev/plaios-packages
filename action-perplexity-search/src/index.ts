import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@agent-os/core/domain";

export interface PerplexitySearchInput {
  query: string;
  maxResults: number | null;
  country: string | null;
  searchRecencyFilter: "hour" | "day" | "week" | "month" | "year" | null;
  searchDomainFilter: string[] | null;
  searchLanguageFilter: string[] | null;
  searchContextSize: "low" | "medium" | "high" | null;
}

export interface PerplexitySearchResultItem {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  lastUpdated?: string;
}

export interface PerplexitySearchOutput {
  id: string;
  results: PerplexitySearchResultItem[];
}

export interface PerplexitySearchClient {
  search: {
    create(
      input: Parameters<Perplexity["search"]["create"]>[0],
    ): ReturnType<Perplexity["search"]["create"]>;
  };
}

export interface PerplexitySearchCapabilityOptions {
  client?: PerplexitySearchClient;
  apiKey?: string;
  env: Environment;
}

const manifest: CapabilityManifest = {
  id: "web.search",
  version: "1.0.0",
  name: "search_web",
  description:
    "Searches the live web with Perplexity and returns ranked sources with snippets. Use it for current events, recent facts, or online research.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The natural-language web search query.",
      },
      maxResults: {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 20,
        description: "Number of results to return, or null to use 5.",
      },
      country: {
        type: ["string", "null"],
        description: "ISO country code to localize the search, or null.",
      },
      searchRecencyFilter: {
        type: ["string", "null"],
        enum: ["hour", "day", "week", "month", "year", null],
        description: "Limit results by recency, or null.",
      },
      searchDomainFilter: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Domains to include or exclude, or null.",
      },
      searchLanguageFilter: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "ISO language codes to include, or null.",
      },
      searchContextSize: {
        type: ["string", "null"],
        enum: ["low", "medium", "high", null],
        description: "Amount of context per result, or null for medium.",
      },
    },
    required: [
      "query",
      "maxResults",
      "country",
      "searchRecencyFilter",
      "searchDomainFilter",
      "searchLanguageFilter",
      "searchContextSize",
    ],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            url: { type: "string" },
            snippet: { type: "string" },
            date: { type: "string" },
            lastUpdated: { type: "string" },
          },
          required: ["title", "url", "snippet"],
          additionalProperties: false,
        },
      },
    },
    required: ["id", "results"],
    additionalProperties: false,
  },
  permissions: ["network.http", "web.search"],
  tags: [
    "web",
    "search",
    "perplexity",
    "internet",
    "online",
    "current",
    "latest",
    "research",
    "news",
  ],
  execution: {
    timeoutMs: 30_000,
    idempotent: true,
  },
  examples: [
    {
      request: "Search the web for the latest TypeScript release",
      arguments: {
        query: "latest TypeScript release",
        maxResults: 5,
        country: null,
        searchRecencyFilter: "month",
        searchDomainFilter: null,
        searchLanguageFilter: ["en"],
        searchContextSize: "medium",
      },
    },
  ],
};

export class PerplexitySearchCapability
  implements Capability<PerplexitySearchInput, PerplexitySearchOutput>
{
  readonly manifest = manifest;

  private readonly client: PerplexitySearchClient;
  private readonly configured: boolean;

  constructor(options: PerplexitySearchCapabilityOptions) {
    if (options.client) {
      this.client = options.client;
      this.configured = true;
      return;
    }

    const apiKey = options.apiKey ?? options.env.get("PERPLEXITY_API_KEY");

    if (!apiKey) {
      throw new Error(
        "PERPLEXITY_API_KEY is required for PerplexitySearchCapability",
      );
    }

    this.client = new Perplexity({ apiKey });
    this.configured = true;
  }

  microfrontendData() {
    return {
      configured: this.configured,
      provider: "Perplexity Search API",
      maxResults: 20,
      recencyFilters: ["hour", "day", "week", "month", "year"],
    };
  }

  async execute(
    input: PerplexitySearchInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<PerplexitySearchOutput>> {
    const query = input.query?.trim();

    if (!query) {
      return failure("VALIDATION_ERROR", "Input 'query' is required", false);
    }

    if (context.signal?.aborted) {
      return failure("SEARCH_ABORTED", "Web search was aborted", true);
    }

    try {
      const response = await this.client.search.create({
        query,
        max_results: normalizeMaxResults(input.maxResults) ?? 5,
        country: input.country ?? undefined,
        search_recency_filter: input.searchRecencyFilter ?? undefined,
        search_domain_filter: input.searchDomainFilter ?? undefined,
        search_language_filter: input.searchLanguageFilter ?? undefined,
        search_context_size: input.searchContextSize ?? "medium",
      });

      return {
        success: true,
        data: {
          id: response.id,
          results: response.results.map((page) => ({
            title: page.title,
            url: page.url,
            snippet: page.snippet,
            date: page.date ?? undefined,
            lastUpdated: page.last_updated ?? undefined,
          })),
        },
      };
    } catch (error) {
      return failure(
        "WEB_SEARCH_FAILED",
        error instanceof Error ? error.message : "Web search failed",
        true,
      );
    }
  }
}

export function normalizeMaxResults(
  value: number | null | undefined,
): number | undefined {
  if (value == null || Number.isNaN(value)) {
    return undefined;
  }

  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function failure(
  code: string,
  message: string,
  retryable: boolean,
): CapabilityResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable,
    },
  };
}

/** @deprecated Use PerplexitySearchCapability. */
export { PerplexitySearchCapability as PerplexityserachCapability };
export type PerplexityserachInput = PerplexitySearchInput;
export type PerplexityserachOutput = PerplexitySearchOutput;
export type PerplexityserachCapabilityOptions =
  PerplexitySearchCapabilityOptions;
