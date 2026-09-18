import assert from "node:assert/strict";
import test from "node:test";
import { createCodexInput, normalizeCodexOutputSchema, shouldFinishAfterCapability } from "../dist/src/index.js";

test("maps Agent OS images to Codex local images", () => {
  const input = createCodexInput({ text: "What is here?", images: [{ path: "/tmp/photo.jpg", mediaType: "image/jpeg" }] }, "Be concise.");
  assert.notEqual(typeof input, "string");
  assert.deepEqual(input[1], { type: "local_image", path: "/tmp/photo.jpg" });
});

test("normalizes optional properties for strict structured output", () => {
  const normalized = normalizeCodexOutputSchema({ type: "object", properties: { operation: { type: "string" }, label: { type: "string" } }, required: ["operation"] });
  assert.deepEqual(normalized, { type: "object", properties: { operation: { type: "string" }, label: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["operation", "label"], additionalProperties: false });
});

test("finishes immediately only after a successful capability with a model-generated confirmation", () => {
  const step = { type: "function-call", finishOnSuccess: true, text: "Fatto." };
  assert.equal(shouldFinishAfterCapability(step, { success: true, data: {} }), true);
  assert.equal(shouldFinishAfterCapability(step, { success: false, error: { message: "failed" } }), false);
  assert.equal(shouldFinishAfterCapability({ ...step, finishOnSuccess: false }, { success: true }), false);
  assert.equal(shouldFinishAfterCapability({ ...step, text: null }, { success: true }), false);
});
