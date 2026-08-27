import assert from "node:assert/strict";
import test from "node:test";
import type {
  AIExecutableFunctionDefinition,
  AIInput,
  AIProvider,
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
} from "@agent-os/core/domain";
import { DefaultAgentLoop } from "../src/index.js";

test("always exposes memory retrieval and forwards message identity", async () => {
  let executionContext: CapabilityExecutionContext | undefined;
  let modelInput: AIInput | undefined;
  const memoryCapability: Capability = {
    manifest: memoryManifest,
    async execute(_input, context) {
      executionContext = context;
      return { success: true, data: [] };
    },
  };
  const model = {
    provider: "test",
    model: "test",
    settings: {},
    async processWithFunctions(
      input: AIInput,
      definitions: readonly AIExecutableFunctionDefinition[],
    ) {
      modelInput = input;
      assert.deepEqual(definitions.map(({ name }) => name), ["memory_retrieval"]);
      await definitions[0]!.execute(
        { query: "Alessia", limit: 20, kinds: null },
        { callId: "call-1" },
      );
      return { type: "text" as const, text: "done" };
    },
    async processInput() {
      return { type: "text" as const, text: "no tools" };
    },
    async functionCall() {
      throw new Error("not used");
    },
  } as AIProvider;
  const loop = new DefaultAgentLoop({
    model,
    capabilityDiscovery: {
      async register() {},
      async get(id) { return id === "memory.retrieval" ? memoryCapability : undefined; },
      async discover() { return []; },
    },
  });

  await loop.run(
    {
      id: "input-1",
      channel: "openrouter-api",
      sessionId: "session-1",
      userId: "thomas",
      text: "Cosa sai su Alessia?",
      attachments: [{
        type: "image",
        path: "/tmp/alessia.jpg",
        mediaType: "image/jpeg",
      }],
      createdAt: new Date(),
    },
    { capabilityIds: [], stream: false },
  );

  assert.equal(executionContext?.userId, "thomas");
  assert.equal(executionContext?.metadata?.inputMessageId, "input-1");
  assert.deepEqual(modelInput, {
    text: "Cosa sai su Alessia?",
    images: [{ path: "/tmp/alessia.jpg", mediaType: "image/jpeg" }],
  });
});

const memoryManifest: CapabilityManifest = {
  id: "memory.retrieval",
  name: "memory_retrieval",
  description: "Search memory",
  inputSchema: { type: "object" },
};
