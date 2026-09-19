import assert from "node:assert/strict";
import test from "node:test";

import { JevOrhcestatorOrchestrator } from "../dist/src/index.js";

const capabilities = [
  {
    id: "home-assistant.control",
    name: "control_home_assistant",
    description: "Control a smart home",
    inputSchema: { type: "object" },
  },
  {
    id: "web.search",
    name: "search_web",
    description: "Search the web",
    inputSchema: { type: "object" },
  },
];

function mockFetch(answers) {
  return async () =>
    new Response(
      JSON.stringify({
        model: "jev-latest",
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

test("selects helping capabilities and the requested output from typed Jev answers", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: mockFetch({
      output: {
        type: "choice",
        choice: "telegram",
        probabilities: { web: 0.1, telegram: 0.9 },
        confidence: 0.8,
      },
      memory: { type: "noul", noul: 0.2 },
      "cap:home-assistant.control": { type: "noul", noul: 0.92 },
      "cap:web.search": { type: "noul", noul: 0.1 },
    }),
    capabilityDiscovery: {
      async discover() {
        return capabilities;
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    { id: "1", channel: "web", text: "turn on the light", createdAt: new Date() },
    [
      { channel: "web", async write() {} },
      { channel: "telegram", async write() {} },
    ],
  );

  assert.deepEqual(decision.capabilityIds, ["home-assistant.control"]);
  assert.equal(decision.outputChannel, "telegram");
  assert.equal(decision.deferMemoryProposal, false);
  assert.equal(decision.additionalOutputs[0].text, "Messaggio inviato su Telegram.");
});

test("keeps capabilities whose noul is at least 0.5, ranked by probability", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: mockFetch({
      memory: { type: "noul", noul: 0.8 },
      "cap:home-assistant.control": { type: "noul", noul: 0.55 },
      "cap:web.search": { type: "noul", noul: 0.91 },
    }),
    capabilityDiscovery: {
      async discover() {
        return capabilities;
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    { id: "1", channel: "web", text: "remember that I like jazz and search for concerts", createdAt: new Date() },
    [{ channel: "web", async write() {} }],
  );

  assert.deepEqual(decision.capabilityIds, ["web.search", "home-assistant.control"]);
  assert.equal(decision.outputChannel, "web");
  assert.equal(decision.deferMemoryProposal, true);
  assert.deepEqual(decision.additionalOutputs, []);
});

test("falls back to all capabilities when Jev fails", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: async () => new Response("offline", { status: 401 }),
    capabilityDiscovery: {
      async discover(query) {
        return query?.text ? [capabilities[0]] : capabilities;
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    { id: "1", channel: "telegram", text: "accendi la luce", createdAt: new Date() },
    [{ channel: "telegram", async write() {} }],
  );

  assert.deepEqual(decision.capabilityIds, ["home-assistant.control", "web.search"]);
  assert.equal(decision.outputChannel, "telegram");
  assert.match(decision.reason, /Jev routing failed/);
});

test("sends a high-confidence direct capability around the generative model", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: mockFetch({
      memory: { type: "noul", noul: 0.1 },
      "cap:home-assistant.jev": { type: "noul", noul: 0.96 },
      "cap:web.search": { type: "noul", noul: 0.2 },
    }),
    capabilityDiscovery: {
      async discover() {
        return [
          {
            id: "home-assistant.jev",
            name: "control_home_assistant_jev",
            description: "Natural-language home control",
            inputSchema: { type: "object" },
            tags: ["direct", "home-assistant"],
          },
          {
            id: "web.search",
            name: "search_web",
            description: "Search the web",
            inputSchema: { type: "object" },
          },
        ];
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    { id: "1", channel: "web", text: "turn off all the lights in the office", createdAt: new Date() },
    [{ channel: "web", async write() {} }],
  );

  assert.equal(decision.bypassModel, true);
  assert.deepEqual(decision.capabilityIds, ["home-assistant.jev"]);
});

test("bypasses to a direct capability even when another capability ranks slightly higher", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: mockFetch({
      memory: { type: "noul", noul: 0.1 },
      "cap:home-assistant.control": { type: "noul", noul: 0.99 },
      "cap:home-assistant.jev": { type: "noul", noul: 0.94 },
    }),
    capabilityDiscovery: {
      async discover() {
        return [
          {
            id: "home-assistant.control",
            name: "control_home_assistant",
            description: "Structured home control",
            inputSchema: { type: "object" },
            tags: ["home-assistant"],
          },
          {
            id: "home-assistant.jev",
            name: "control_home_assistant_jev",
            description: "Natural-language home control",
            inputSchema: { type: "object" },
            tags: ["direct", "home-assistant"],
          },
        ];
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    { id: "1", channel: "web", text: "spegni le luci in ufficio", createdAt: new Date() },
    [{ channel: "web", async write() {} }],
  );

  assert.equal(decision.bypassModel, true);
  assert.deepEqual(decision.capabilityIds, ["home-assistant.jev"]);
});

test("sends the last 10 conversation turns to Jev for follow-up routing", async () => {
  let body;
  const orchestrator = new JevOrhcestatorOrchestrator({
    apiKey: "test",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return mockFetch({
        memory: { type: "noul", noul: 0.1 },
        "cap:home-assistant.jev": { type: "noul", noul: 0.91 },
      })();
    },
    capabilityDiscovery: {
      async discover() {
        return [
          {
            id: "home-assistant.jev",
            name: "control_home_assistant_jev",
            description: "Natural-language home control",
            inputSchema: { type: "object" },
            tags: ["direct", "home-assistant"],
          },
        ];
      },
    },
  });

  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn ${index + 1}`,
  }));

  const decision = await orchestrator.orchestrate(
    {
      id: "1",
      channel: "web",
      text: "Le metti blu",
      createdAt: new Date(),
      metadata: {
        originalText: "Le metti blu",
        conversationHistory: history,
      },
    },
    [{ channel: "web", async write() {} }],
  );

  assert.equal(decision.bypassModel, true);
  assert.deepEqual(body.state.history, history.slice(-10));
  assert.equal(body.state.text, "Le metti blu");
});

