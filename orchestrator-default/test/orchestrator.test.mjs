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
