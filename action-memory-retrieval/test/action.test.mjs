import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRetrievalCapability } from "../dist/src/index.js";

test("retrieves durable memory and links provenance", async () => {
  const links = [];
  const memory = { constructor: { name: "TestGraphMemory" }, recall: async (query) => [{ id: "fact-1", kind: "semantic", content: "AgentOS v2", createdAt: new Date("2026-08-01T00:00:00Z"), userId: query.userId, metadata: { graphScore: 0.9 } }], link: async (edge) => links.push(edge) };
  const action = new MemoryRetrievalCapability({ memory, defaultLimit: 10, maxLimit: 25 });
  const result = await action.execute({ query: "AgentOS", limit: null, kinds: null }, { runId: "run-1", callId: "call-1", userId: "thomas", startedAt: new Date(), metadata: { inputMessageId: "input-1" } });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.count, 1);
  assert.equal(links.length, 1);
  assert.equal(action.microfrontendData().maxLimit, 25);
});
