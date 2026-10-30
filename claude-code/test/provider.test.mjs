import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ClaudeCodeProvider, createFunctionStepSchema, imageFromCapabilityOutput, normalizeOutputSchema, parseFunctionStep, partialFinalText, shouldFinishAfterCapability, userContent } from "../dist/src/index.js";

test("sends plain text as a string and images as base64 blocks", async () => {
  assert.equal(await userContent("  hello  "), "hello");
  const dir = await mkdtemp(join(tmpdir(), "claude-code-"));
  const path = join(dir, "shot.png");
  await writeFile(path, Buffer.from([1, 2, 3]));
  const content = await userContent({ text: "What is here?", images: [{ path }] });
  assert.deepEqual(content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } });
  await assert.rejects(userContent("   "), /input is required/);
  await assert.rejects(userContent({ text: "x", images: [{ path: join(dir, "file.bmp") }] }), /Unsupported image type/);
});

test("normalizes optional properties for strict structured output", () => {
  const normalized = normalizeOutputSchema({ type: "object", properties: { operation: { type: "string" }, label: { type: "string" } }, required: ["operation"] });
  assert.deepEqual(normalized, { type: "object", properties: { operation: { type: "string" }, label: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["operation", "label"], additionalProperties: false });
});

test("the step schema only allows known capability names", () => {
  const schema = createFunctionStepSchema([{ name: "get_time", description: "Time", inputSchema: { type: "object", properties: {} }, execute: async () => ({}) }]);
  assert.deepEqual(schema.properties.name.enum, ["", "get_time"]);
});

test("parses structured steps given as objects or JSON", () => {
  const step = { type: "text", name: "", arguments: null, text: "Hi", finishOnSuccess: false };
  assert.deepEqual(parseFunctionStep(step), step);
  assert.deepEqual(parseFunctionStep(JSON.stringify(step)), step);
  assert.throws(() => parseFunctionStep({ type: "other" }), /invalid function step/);
});

test("streams the final text out of an incomplete step", () => {
  assert.equal(partialFinalText('{"type":"function-call","name":"x"'), undefined);
  assert.equal(partialFinalText('{"type":"text","name":"","arguments":null,"text":"Ciao\\nmon'), "Ciao\nmon");
});

test("finishes early only after a successful capability with a confirmation", () => {
  const step = { type: "function-call", finishOnSuccess: true, text: "Done." };
  assert.equal(shouldFinishAfterCapability(step, { success: true }), true);
  assert.equal(shouldFinishAfterCapability(step, { success: false }), false);
});

test("passes a capability screenshot on to the model", () => {
  assert.equal(imageFromCapabilityOutput({ success: true, data: { localPath: "/tmp/s.png" } }), "/tmp/s.png");
  assert.equal(imageFromCapabilityOutput({ success: true, data: { localPath: "/tmp/s.txt" } }), undefined);
});

test("defaults to Claude Opus 5.5 and reports the credential source", () => {
  const provider = new ClaudeCodeProvider({ apiKey: "sk-test" });
  assert.equal(provider.model, "claude-opus-5-5");
  assert.equal(provider.microfrontendData().credentialMode, "api-key");
});
