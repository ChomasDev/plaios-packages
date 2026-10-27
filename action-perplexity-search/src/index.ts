import Perplexity from "@perplexity-ai/perplexity_ai";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Database,
  Environment,
  UIComponentSpec,
} from "@agent-os/core/domain";

import { SearchStore, type StoredSearch } from "./search-store.js";
import { WEB_SOURCES } from "./ui-components.js";

export { WEB_SOURCES } from "./ui-components.js";
export type { StoredSearch } from "./search-store.js";

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
  /** Scoped database from the host; searches are kept there so WebSources cards outlive a restart. */
  database?: Database;
}

const DOCS = `Searches the live web through the Perplexity Search API and returns ranked sources (title, url, snippet, date).

**Use it** for anything that may have changed since your training: news, prices, releases, schedules, people's current roles, or when the user asks you to look something up. **Don't use it** for things memory or another capability already knows (the user's own devices, files, schedules).

**Inputs**
- \`query\`: write it like a search, specific and self-contained: \`{"query":"Node.js 26 release date"}\`.
- \`searchRecencyFilter\` for fresh topics: \`{"query":"Serie A results","searchRecencyFilter":"day"}\`.
- \`searchDomainFilter\` to stay on trusted sites: \`{"query":"fastify v6 breaking changes","searchDomainFilter":["fastify.dev","github.com"]}\`.
- \`maxResults\` defaults to 5 (max 20); more results cost more tokens.

**After searching**, answer from the snippets and cite sources. In the web chat, show them with \`WebSources("<id>")\` using the returned \`id\` instead of pasting links.

**Limits**: 30 s timeout; snippets are short, so say so when they are not enough instead of guessing. A failure with WEB_SEARCH_FAILED is retryable once.`;

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
  private readonly searches: SearchStore;

  constructor(options: PerplexitySearchCapabilityOptions) {
    this.searches = new SearchStore(options.database);
    const apiKey = options.apiKey ?? options.env.get("PERPLEXITY_API_KEY");
    if (!options.client && !apiKey) {
      throw new Error("PERPLEXITY_API_KEY is required for PerplexitySearchCapability");
    }
    this.client = options.client ?? new Perplexity({ apiKey });
  }

  microfrontendData() {
    return {
      configured: true,
      provider: "Perplexity Search API",
      maxResults: 20,
      recencyFilters: ["hour", "day", "week", "month", "year"],
      // `queries` only read; WebSources cards fetch one stored search by id.
      queries: {
        search: async (id: string): Promise<StoredSearch | null> => (await this.searches.find(id)) ?? null,
      },
    };
  }

  uiComponents(): readonly UIComponentSpec[] {
    return [WEB_SOURCES];
  }

  docs(): string {
    return DOCS;
  }

  async execute(
    input: PerplexitySearchInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<PerplexitySearchOutput>> {
    const query = input.query?.trim();
    if (!query) return failure("VALIDATION_ERROR", "Input 'query' is required", false);
    if (context.signal?.aborted) return failure("SEARCH_ABORTED", "Web search was aborted", true);

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

      const results = response.results.map((page) => ({
        title: page.title,
        url: page.url,
        snippet: page.snippet,
        date: page.date ?? undefined,
        lastUpdated: page.last_updated ?? undefined,
      }));
      // A card that cannot load its sources is worse than none, but storing must never fail the search itself.
      await this.searches.save({ id: response.id, query, results, createdAt: new Date().toISOString() })
        .catch((error: unknown) => console.warn(`[perplexity] could not store search ${response.id}: ${error instanceof Error ? error.message : String(error)}`));
      return { success: true, data: { id: response.id, results } };
    } catch (error) {
      return failure(
        "WEB_SEARCH_FAILED",
        error instanceof Error ? error.message : "Web search failed",
        true,
      );
    }
  }
}

export function normalizeMaxResults(value: number | null | undefined): number | undefined {
  if (value == null || Number.isNaN(value)) return undefined;
  return Math.min(20, Math.max(1, Math.trunc(value)));
}

function failure(code: string, message: string, retryable: boolean): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
