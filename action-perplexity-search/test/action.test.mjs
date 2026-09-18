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
