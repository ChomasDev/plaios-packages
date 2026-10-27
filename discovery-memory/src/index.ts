import type { Capability, CapabilityDiscovery, CapabilityDiscoveryQuery, CapabilityManifest } from "@agent-os/core";

export interface DiscoveryMicrofrontendData {
  capabilityCount: number;
  versionCount: number;
  capabilities: CapabilityManifest[];
  search: (query: CapabilityDiscoveryQuery) => Promise<readonly CapabilityManifest[]>;
}

export class InMemoryCapabilityDiscovery implements CapabilityDiscovery {
  private readonly capabilities = new Map<string, Capability[]>();
  async register(capability: Capability): Promise<void> { const registered = this.capabilities.get(capability.manifest.id) ?? []; const version = capability.manifest.version; const index = registered.findIndex((candidate) => candidate.manifest.version === version); if (index >= 0) registered[index] = capability; else registered.push(capability); this.capabilities.set(capability.manifest.id, registered); }
  async get(id: string, version?: string): Promise<Capability | undefined> { const registered = this.capabilities.get(id); return version ? registered?.find((candidate) => candidate.manifest.version === version) : registered?.at(-1); }
  async discover(query: CapabilityDiscoveryQuery = {}): Promise<readonly CapabilityManifest[]> {
    const tags = new Set(query.tags?.map(normalize).filter(Boolean));
    const terms = tokens(query.text).filter((term) => !STOP_WORDS.has(term));
    const limit = Math.max(0, query.limit ?? Number.POSITIVE_INFINITY);
    return [...this.capabilities.values()].flatMap((versions) => versions.at(-1) ?? []).map((capability) => ({ manifest: capability.manifest, score: scoreManifest(capability.manifest, terms, tags) })).filter(({ score }) => score >= 0).sort((left, right) => right.score - left.score).slice(0, limit).map(({ manifest }) => manifest);
  }
  microfrontendData(): DiscoveryMicrofrontendData {
    const capabilities = [...this.capabilities.values()].flatMap((versions) => versions.at(-1)?.manifest ?? []);
    return { capabilityCount: capabilities.length, versionCount: [...this.capabilities.values()].reduce((total, versions) => total + versions.length, 0), capabilities, search: (query) => this.discover(query) };
  }
}

function scoreManifest(manifest: CapabilityManifest, terms: readonly string[], requestedTags: ReadonlySet<string>): number {
  const manifestTags = new Set(manifest.tags?.map(normalize).filter(Boolean));
  if (requestedTags.size > 0 && [...requestedTags].some((tag) => !manifestTags.has(tag))) return -1;
  if (terms.length === 0) return requestedTags.size > 0 ? requestedTags.size : 0;
  const searchable = normalize([manifest.id, manifest.name, manifest.description, ...(manifest.tags ?? []), ...(manifest.examples?.map(({ request }) => request) ?? []), JSON.stringify(manifest.inputSchema)].join(" "));
  const searchableTokens = new Set(tokens(searchable));
  const matches = terms.filter((term) => searchableTokens.has(term)).length;
  return matches > 0 ? matches : -1;
}

function normalize(value?: string): string { return value?.trim().toLowerCase() ?? ""; }
function tokens(value?: string): string[] { return normalize(value).match(/[\p{L}\p{N}_-]+/gu) ?? []; }
const STOP_WORDS = new Set(["a", "about", "and", "are", "can", "chi", "come", "con", "cosa", "could", "dei", "del", "della", "dimmi", "do", "does", "dove", "from", "how", "il", "is", "know", "la", "me", "mia", "mio", "my", "per", "perche", "please", "potresti", "puoi", "sei", "should", "sono", "tell", "the", "this", "that", "una", "uno", "what", "when", "where", "which", "who", "why", "with", "would"]);
