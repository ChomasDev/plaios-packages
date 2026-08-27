import assert from "node:assert/strict";
import test from "node:test";
import { createCodexInput, normalizeCodexOutputSchema } from "../dist/src/index.js";

test("maps Agent OS images to Codex local images", () => {
  const input = createCodexInput({ text: "What is here?", images: [{ path: "/tmp/photo.jpg", mediaType: "image/jpeg" }] }, "Be concise.");
  assert.notEqual(typeof input, "string");
  assert.deepEqual(input[1], { type: "local_image", path: "/tmp/photo.jpg" });
});

test("normalizes optional properties for strict structured output", () => {
  const normalized = normalizeCodexOutputSchema({ type: "object", properties: { operation: { type: "string" }, label: { type: "string" } }, required: ["operation"] });
  assert.deepEqual(normalized, { type: "object", properties: { operation: { type: "string" }, label: { anyOf: [{ type: "string" }, { type: "null" }] } }, required: ["operation", "label"], additionalProperties: false });
});
