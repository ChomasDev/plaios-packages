import assert from "node:assert/strict";
import test from "node:test";
import { PerplexitySearchCapability, normalizeMaxResults } from "../dist/src/index.js";

test("normalizes result limits and maps ranked sources", async () => {
  const client = { search: { create: async (input) => ({ id: "search-1", results: [{ title: "AgentOS", url: "https://example.com", snippet: input.query, date: null, last_updated: null }] }) } };
  const action = new PerplexitySearchCapability({ client, env: { get: () => undefined } });
  const result = await action.execute({ query: "current AgentOS news", maxResults: 100, country: null, searchRecencyFilter: "week", searchDomainFilter: null, searchLanguageFilter: ["en"], searchContextSize: "medium" }, { runId: "run-1", callId: "call-1", startedAt: new Date() });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.results[0].title, "AgentOS");
  assert.equal(normalizeMaxResults(100), 20);
  assert.equal(action.microfrontendData().configured, true);
});

test("keeps each search so its WebSources card can load it by id", async () => {
  const client = { search: { create: async () => ({ id: "search-7", results: [{ title: "Docs", url: "https://fastify.dev", snippet: "v6", date: "2026-10-01", last_updated: null }] }) } };
  const action = new PerplexitySearchCapability({ client, env: { get: () => undefined } });
  await action.execute({ query: "fastify v6", maxResults: null, country: null, searchRecencyFilter: null, searchDomainFilter: null, searchLanguageFilter: null, searchContextSize: null }, { runId: "r", callId: "c", startedAt: new Date() });
  const stored = await action.microfrontendData().queries.search("search-7");
  assert.equal(stored.query, "fastify v6");
  assert.equal(stored.results[0].url, "https://fastify.dev");
  assert.equal(await action.microfrontendData().queries.search("unknown"), null);
  assert.deepEqual(action.uiComponents().map((spec) => spec.name), ["WebSources"]);
  assert.match(action.docs(), /WebSources/);
});
