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

test("bypassModel executes the capability with raw text and skips the generative model", async () => {
  let modelCalls = 0;
  let received: unknown;
  const home: Capability = {
    manifest: {
      id: "home-assistant.jev",
      name: "control_home_assistant_jev",
      description: "Natural-language home control",
      inputSchema: { type: "object" },
    },
    async execute(input) {
      received = input;
      return { success: true, data: { summary: "Turned off Office." } };
    },
  };
  const loop = new DefaultAgentLoop({
    model: {
      provider: "test",
      model: "test",
      settings: {},
      async processWithFunctions() {
        modelCalls += 1;
        return { type: "text" as const, text: "model" };
      },
      async processInput() {
        modelCalls += 1;
        return { type: "text" as const, text: "model" };
      },
      async functionCall() {
        throw new Error("not used");
      },
    } as AIProvider,
    capabilityDiscovery: {
      async register() {},
      async get(id) {
        return id === "home-assistant.jev" ? home : undefined;
      },
      async discover() {
        return [];
      },
    },
    alwaysCapabilityIds: [],
  });

  const result = await loop.run(
    {
      id: "input-2",
      channel: "web",
      sessionId: "session-1",
      text: "turn off all the lights in the office",
      createdAt: new Date(),
    },
    { capabilityIds: ["home-assistant.jev"], stream: false, bypassModel: true },
  );

  assert.equal(modelCalls, 0);
  assert.deepEqual(received, { text: "turn off all the lights in the office" });
  assert.deepEqual(result, { type: "text", text: "Turned off Office." });

  await loop.run(
    {
      id: "input-3",
      channel: "web",
      sessionId: "session-1",
      text: "Conversation history:\nUSER: Spegni le luci in ufficio\nCurrent request:\nImposta verdi",
      createdAt: new Date(),
      metadata: {
        originalText: "Imposta verdi",
        conversationHistory: [
          { role: "user", content: "Spegni le luci in ufficio" },
          { role: "assistant", content: "Fatto, ho spento Luce ufficio." },
        ],
      },
    },
    { capabilityIds: ["home-assistant.jev"], stream: false, bypassModel: true },
  );
  assert.deepEqual(received, {
    text: "Imposta verdi",
    history: [
      { role: "user", content: "Spegni le luci in ufficio" },
      { role: "assistant", content: "Fatto, ho spento Luce ufficio." },
    ],
  });
});

test("returns a protocol confirmation without calling a capability", async () => {
  let modelCalls = 0;
  const loop = new DefaultAgentLoop({
    model: {
      provider: "test",
      model: "test",
      settings: {},
      async processWithFunctions() {
        modelCalls += 1;
        return { type: "text" as const, text: "model" };
      },
      async processInput() {
        modelCalls += 1;
        return { type: "text" as const, text: "model" };
      },
      async functionCall() {
        throw new Error("not used");
      },
    } as AIProvider,
    capabilityDiscovery: {
      async register() {},
      async get() { return undefined; },
      async discover() { return []; },
    },
    alwaysCapabilityIds: [],
  });

  const result = await loop.run(
    {
      id: "input-4",
      channel: "web",
      sessionId: "session-1",
      text: 'ricorda che quando dico "protocollo ragazza in casa" devi impostare le luci rosse',
      createdAt: new Date(),
      metadata: {
        protocolConfirmation: 'Ok, quando dici "protocollo ragazza in casa" eseguo: imposta le luci del ufficio rosse.',
      },
    },
    { capabilityIds: [], stream: false, bypassModel: true },
  );

  assert.equal(modelCalls, 0);
  assert.equal(result.type, "text");
  assert.match(result.text, /protocollo ragazza in casa/);
});

test("after a screenshot, describes the image when the user asked what it sees", async () => {
  let modelInput: AIInput | undefined;
  const ssh: Capability = {
    manifest: {
      id: "ssh.jev",
      name: "control_remote_computer_jev",
      description: "Natural-language remote computer control",
      inputSchema: { type: "object" },
    },
    async execute() {
      return {
        success: true,
        data: {
          summary: "Captured a screenshot on Mac di Thomas.",
          localPath: "/tmp/agent-os-screenshot.png",
        },
      };
    },
  };
  const loop = new DefaultAgentLoop({
    model: {
      provider: "test",
      model: "test",
      settings: {},
      async processWithFunctions() {
        throw new Error("processWithFunctions should not run");
      },
      async processInput(input) {
        modelInput = input;
        return { type: "text" as const, text: "Vedo Cursor aperto su un file TypeScript." };
      },
      async functionCall() {
        throw new Error("not used");
      },
    } as AIProvider,
    capabilityDiscovery: {
      async register() {},
      async get(id) {
        return id === "ssh.jev" ? ssh : undefined;
      },
      async discover() {
        return [];
      },
    },
    alwaysCapabilityIds: [],
  });

  const result = await loop.run(
    {
      id: "input-5",
      channel: "openrouter-api",
      sessionId: "session-1",
      text: "Riesce a fare uno screenshot del Mac e scrivermi su Telegram cosa vedi?",
      createdAt: new Date(),
    },
    { capabilityIds: ["ssh.jev"], stream: false, bypassModel: true },
  );

  assert.deepEqual(modelInput, {
    text: [
      'The user said: "Riesce a fare uno screenshot del Mac e scrivermi su Telegram cosa vedi?"',
      "Captured a screenshot on Mac di Thomas.",
      "A screenshot was captured. Describe clearly what you see on the screen, in the user's language.",
      "Be specific about apps, windows, text, and layout. Do not mention file paths unless useful.",
    ].join("\n"),
    images: [{ path: "/tmp/agent-os-screenshot.png", mediaType: "image/png" }],
  });
  assert.equal(result.type, "text");
  assert.match(result.text, /Cursor/);
});

const memoryManifest: CapabilityManifest = {
  id: "memory.retrieval",
  name: "memory_retrieval",
  description: "Search memory",
  inputSchema: { type: "object" },
};
