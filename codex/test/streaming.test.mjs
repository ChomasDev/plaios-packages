import assert from "node:assert/strict";
import test from "node:test";
import { CodexProvider, partialFinalText } from "../dist/src/index.js";

test("decodes the text of an incomplete final step and ignores tool-call steps", () => {
  assert.equal(partialFinalText('{"type":"text","name":"","arguments":null,"text":"Ciao \\"mondo\\"\\n'), 'Ciao "mondo"\n');
  assert.equal(partialFinalText('{"type":"text","name":"","arguments":null,"text":"abc\\u00e'), "abc");
  assert.equal(partialFinalText('{"type":"text","name":"","arguments":null,"text":"done","finishOnSuccess":false}'), "done");
  assert.equal(partialFinalText('{"type":"text","name":"",'), "");
  assert.equal(partialFinalText('{"type":"function-call","name":"x","arguments":{"text":"no"}'), undefined);
});

test("streams the final answer in deltas while the step JSON arrives", async () => {
  const step = '{"type":"text","name":"","arguments":null,"text":"Hello world","finishOnSuccess":false}';
  const chunks = [step.slice(0, 50), step.slice(0, 60), step];
  const thread = {
    run: async () => ({ finalResponse: step }),
    runStreamed: async () => ({ events: (async function* () { for (const text of chunks) yield { type: "item.updated", item: { type: "agent_message", text } }; })() }),
  };
  const provider = new CodexProvider({ model: "test" });
  provider.codex = { startThread: () => thread };
  const result = await provider.processWithFunctions("hi", [{ name: "noop", description: "", inputSchema: { type: "object", properties: {} }, execute: async () => ({}) }], { stream: true });
  const deltas = [];
  for await (const delta of result.stream) deltas.push(delta);
  assert.deepEqual(deltas, ["Hello worl", "d"]);
});
