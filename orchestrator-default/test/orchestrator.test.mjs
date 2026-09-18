import assert from "node:assert/strict";
import test from "node:test";
import { DefaultOrchestrator } from "../dist/src/index.js";

test("routes explicit Telegram delivery without model routing", async () => {
  let calls = 0;
  const orchestrator = new DefaultOrchestrator({ model: { provider: "test", model: "test", settings: {}, async functionCall() { calls += 1; throw new Error("not expected"); } }, capabilityDiscovery: { async discover() { return []; } } });
  const decision = await orchestrator.orchestrate({ id: "1", channel: "web", text: "Mandami un messaggio su Telegram", createdAt: new Date() }, [{ channel: "web", async write() {} }, { channel: "telegram", async write() {} }]);
  assert.equal(calls, 0); assert.equal(decision.outputChannel, "telegram"); assert.equal(decision.additionalOutputs[0].text, "Messaggio inviato su Telegram.");
});

test("uses deterministic single-output fast path", async () => {
  let calls = 0;
  const orchestrator = new DefaultOrchestrator({ fastPath: true, model: { provider: "test", model: "test", settings: {}, async functionCall() { calls += 1; throw new Error("not expected"); } }, capabilityDiscovery: { async discover() { return []; } } });
  const decision = await orchestrator.orchestrate({ id: "1", channel: "web", text: "hello", createdAt: new Date() }, [{ channel: "web", async write() {} }]);
  assert.equal(calls, 0); assert.equal(decision.deferMemoryProposal, true); assert.deepEqual(decision.capabilityIds, []);
});

test("fast path supplies baseline capabilities when text has no deterministic match", async () => {
  let calls = 0;
  const capabilities = [
    { id: "home-assistant.control", version: "1.0.0", name: "control_home_assistant", description: "Control a smart home", inputSchema: { type: "object" } },
    { id: "web.search", version: "1.0.0", name: "search_web", description: "Search the web", inputSchema: { type: "object" } },
  ];
  const orchestrator = new DefaultOrchestrator({
    fastPath: true,
    minCapabilities: 30,
    model: { provider: "test", model: "test", settings: {}, async functionCall() { calls += 1; throw new Error("not expected"); } },
    capabilityDiscovery: { async discover(query) { return query?.text ? [] : capabilities; } },
  });
  const decision = await orchestrator.orchestrate({ id: "1", channel: "telegram", text: "Quali dispositivi ho a casa?", createdAt: new Date() }, [{ channel: "telegram", async write() {} }]);
  assert.equal(calls, 0);
  assert.deepEqual(decision.capabilityIds, ["home-assistant.control", "web.search"]);
});

test("fast path skips model routing when dynamic discovery finds a capability", async () => {
  let calls = 0;
  const homeAssistant = { id: "home-assistant.control", version: "1.1.0", name: "control_home_assistant", description: "Control a smart home", inputSchema: { type: "object" } };
  const memory = { id: "memory.retrieval", version: "1.0.0", name: "memory_retrieval", description: "Retrieve memories", inputSchema: { type: "object" } };
  const orchestrator = new DefaultOrchestrator({
    fastPath: true,
    minCapabilities: 2,
    model: { provider: "test", model: "test", settings: {}, async functionCall() { calls += 1; throw new Error("not expected"); } },
    capabilityDiscovery: { async discover(query) { return query?.text ? [homeAssistant] : [memory, homeAssistant]; } },
  });
  const decision = await orchestrator.orchestrate({ id: "1", channel: "telegram", text: "accendi la tv", createdAt: new Date() }, [{ channel: "telegram", async write() {} }]);
  assert.equal(calls, 0);
  assert.deepEqual(decision.capabilityIds, ["home-assistant.control", "memory.retrieval"]);
  assert.equal(decision.deferMemoryProposal, true);
});

test("model routing is padded to the configured minimum", async () => {
  const capabilities = [
    { id: "one", version: "1.0.0", name: "one", description: "One", inputSchema: { type: "object" } },
    { id: "two", version: "1.0.0", name: "two", description: "Two", inputSchema: { type: "object" } },
    { id: "three", version: "1.0.0", name: "three", description: "Three", inputSchema: { type: "object" } },
  ];
  const orchestrator = new DefaultOrchestrator({
    minCapabilities: 2,
    model: { provider: "test", model: "test", settings: {}, async functionCall() { return { arguments: { capabilityIds: [], outputChannel: "telegram", additionalOutputs: [], memoryProposals: [], reason: "none" } }; } },
    capabilityDiscovery: { async discover() { return capabilities; } },
  });
  const decision = await orchestrator.orchestrate({ id: "1", channel: "telegram", text: "hello", createdAt: new Date() }, [{ channel: "telegram", async write() {} }]);
  assert.deepEqual(decision.capabilityIds, ["one", "two"]);
});
