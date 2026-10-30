import assert from "node:assert/strict";
import test from "node:test";
import type { Capability, CapabilityDiscovery, Memory, MemoryEntry } from "@plaios/core/domain";
import { VoiceLiveInput, toolName } from "../src/index.js";

const echo: Capability = {
  manifest: { id: "action:echo", name: "echo.say hi", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  async execute(input, context) { return { success: true, data: { input, userId: context.userId } }; },
  uiComponents: () => [],
  docs: () => "",
};
const discovery: CapabilityDiscovery = {
  async register() {},
  async get(id) { return id === echo.manifest.id ? echo : undefined; },
  async discover() { return [echo.manifest]; },
};

const stored: MemoryEntry[] = [];
const memory = {
  async remember(entry: MemoryEntry) { stored.push(entry); },
  async recall() { return [{ id: "m1", kind: "semantic", content: "Lives in Treviso", createdAt: new Date() }] as MemoryEntry[]; },
} as unknown as Memory;

test("mints a client secret whose session carries every capability as a tool and the user's memories", async () => {
  let body: any;
  const input = new VoiceLiveInput({
    apiKey: "sk-test", capabilityDiscovery: discovery, userId: "thomas", memory,
    fetch: (async (_url: unknown, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ value: "ek_123" })); }) as typeof fetch,
  });
  const session = await input.createSession();
  assert.equal(session.clientSecret, "ek_123");
  assert.deepEqual(body.session.tools, [{ type: "function", name: "echo_say_hi", description: "Echo", parameters: echo.manifest.inputSchema }]);
  assert.equal(body.session.audio.output.voice, "marin");
  assert.match(body.session.instructions, /Lives in Treviso/);
  assert.equal(body.session.audio.input.transcription.language, undefined);

  await input.remember("user", "ciao");
  assert.equal(stored[0]?.userId, "thomas");
  assert.deepEqual(stored[0]?.metadata, { namespace: "chat-history", role: "user", channel: "voice-live" });

  input.microfrontendData().newChat();
  await input.remember("user", "nuova chat");
  assert.notEqual(stored[1]?.sessionId, stored[0]?.sessionId);

  const result = await input.callTool("echo_say_hi", { text: "ciao" }) as any;
  assert.deepEqual(result.data, { input: { text: "ciao" }, userId: "thomas" });
  const unknown = await input.callTool("nope", {}) as any;
  assert.equal(unknown.success, false);
});

test("tool names are sanitized and unique", () => {
  const taken = new Map([["a_b", "x"]]);
  assert.equal(toolName({ id: "1", name: "a b", description: "", inputSchema: {} }, taken), "a_b_2");
});

test("a configured language fixes transcription and the reply language", async () => {
  let body: any;
  const input = new VoiceLiveInput({
    apiKey: "sk-test", language: "IT",
    fetch: (async (_url: unknown, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ value: "ek_123" })); }) as typeof fetch,
  });
  await input.createSession();
  assert.equal(body.session.audio.input.transcription.language, "it");
  assert.match(body.session.instructions, /always reply in Italian/);
  assert.match(body.session.instructions, /native Italian speaker/);
  assert.throws(() => new VoiceLiveInput({ language: "italiano" }), /ISO-639-1/);
});
