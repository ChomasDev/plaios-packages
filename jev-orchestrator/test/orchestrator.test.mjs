import assert from "node:assert/strict";
import test from "node:test";
import { JevSystem1 } from "@agent-os/system1-jev";

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

test("sends the reply to Telegram when the user asks for it", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    system1: new JevSystem1({ apiKey: "test", fetch: mockFetch({
      output: {
        type: "choice",
        choice: "openrouter-api",
        probabilities: { "openrouter-api": 0.8, telegram: 0.2 },
        confidence: 0.7,
      },
      memory: { type: "noul", noul: 0.1 },
      "cap:ssh.jev": { type: "noul", noul: 0.95 },
    }) }),
    capabilityDiscovery: {
      async discover() {
        return [{
          id: "ssh.jev",
          name: "control_remote_computer_jev",
          description: "Natural-language remote computer control",
          inputSchema: { type: "object" },
          tags: ["direct", "ssh"],
        }];
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    {
      id: "1",
      channel: "openrouter-api",
      text: "Riesce a fare uno screenshot del Mac e scrivermi su Telegram cosa vedi?",
      createdAt: new Date(),
    },
    [
      { channel: "openrouter-api", async write() {} },
      { channel: "telegram", async write() {} },
    ],
  );

  assert.equal(decision.outputChannel, "telegram");
  assert.equal(decision.bypassModel, false);
  assert.deepEqual(decision.capabilityIds, ["ssh.jev"]);
  assert.match(decision.reason, /Multi-step/);
  assert.equal(decision.additionalOutputs[0].text, "Messaggio inviato su Telegram.");
});

test("selects helping capabilities and the requested output from typed Jev answers", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    system1: new JevSystem1({ apiKey: "test", fetch: mockFetch({
      output: {
        type: "choice",
        choice: "telegram",
        probabilities: { web: 0.1, telegram: 0.9 },
        confidence: 0.8,
      },
      memory: { type: "noul", noul: 0.2 },
      "cap:home-assistant.control": { type: "noul", noul: 0.92 },
      "cap:web.search": { type: "noul", noul: 0.1 },
    }) }),
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
    system1: new JevSystem1({ apiKey: "test", fetch: mockFetch({
      memory: { type: "noul", noul: 0.8 },
      "cap:home-assistant.control": { type: "noul", noul: 0.55 },
      "cap:web.search": { type: "noul", noul: 0.91 },
    }) }),
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
    system1: new JevSystem1({ apiKey: "test", fetch: async () => new Response("offline", { status: 401 }) }),
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
  assert.match(decision.reason, /routing failed/);
});

test("sends a high-confidence direct capability around the generative model", async () => {
  const orchestrator = new JevOrhcestatorOrchestrator({
    system1: new JevSystem1({ apiKey: "test", fetch: mockFetch({
      memory: { type: "noul", noul: 0.1 },
      "cap:home-assistant.jev": { type: "noul", noul: 0.96 },
      "cap:web.search": { type: "noul", noul: 0.2 },
    }) }),
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
    system1: new JevSystem1({ apiKey: "test", fetch: mockFetch({
      memory: { type: "noul", noul: 0.1 },
      "cap:home-assistant.control": { type: "noul", noul: 0.99 },
      "cap:home-assistant.jev": { type: "noul", noul: 0.94 },
    }) }),
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
    system1: new JevSystem1({ apiKey: "test", fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return mockFetch({
        memory: { type: "noul", noul: 0.1 },
        "cap:home-assistant.jev": { type: "noul", noul: 0.91 },
      })();
    } }),
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

const sshCapabilities = [
  {
    id: "ssh.jev",
    name: "control_remote_computer_jev",
    description: "Natural-language remote computer control",
    inputSchema: { type: "object" },
    tags: ["direct", "ssh", "mac"],
  },
];

test("remembers a protocol phrase without forcing a remote-computer capability", async () => {
  const stored = [];
  const message = {
    id: "1",
    channel: "web",
    userId: "thomas",
    text: 'ricorda che quando dico "protocollo ragazza in casa" devi impostare le luci del ufficio rosse',
    createdAt: new Date(),
    metadata: {},
  };
  const orchestrator = new JevOrhcestatorOrchestrator({
    system1: new JevSystem1({ apiKey: "test", fetch: async () => {
      throw new Error("Jev should not be called when remembering a protocol");
    } }),
    memory: {
      async upsertNode(node) {
        stored.push(node);
        return node;
      },
      async remember(entry) {
        stored.push(entry);
      },
    },
    capabilityDiscovery: {
      async discover() {
        return sshCapabilities;
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    message,
    [{ channel: "web", async write() {} }],
  );

  assert.equal(decision.bypassModel, true);
  assert.deepEqual(decision.capabilityIds, []);
  assert.equal(message.metadata.protocolTrigger, "protocollo ragazza in casa");
  assert.match(message.metadata.protocolConfirmation, /protocollo ragazza in casa/);
  assert.ok(stored.some((item) => item.type === "protocol" && item.label === "protocollo ragazza in casa"));
});

test("expands a remembered protocol and routes the action with Jev", async () => {
  let body;
  const message = {
    id: "1",
    channel: "web",
    userId: "thomas",
    text: "protocollo ragazza in casa",
    createdAt: new Date(),
    metadata: {},
  };
  const orchestrator = new JevOrhcestatorOrchestrator({
    system1: new JevSystem1({ apiKey: "test", fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return mockFetch({
        memory: { type: "noul", noul: 0.1 },
        "cap:home-assistant.jev": { type: "noul", noul: 0.95 },
        "cap:ssh.jev": { type: "noul", noul: 0.1 },
      })();
    } }),
    memory: {
      async listNodes() {
        return [{
          type: "protocol",
          label: "protocollo ragazza in casa",
          data: {
            trigger: "protocollo ragazza in casa",
            expansion: "imposta le luci del ufficio rosse",
          },
        }];
      },
    },
    capabilityDiscovery: {
      async discover() {
        return [
          {
            id: "home-assistant.jev",
            name: "control_home_assistant_jev",
            description: "Natural-language home control",
            inputSchema: { type: "object" },
            tags: ["direct", "home-assistant", "luci"],
          },
          ...sshCapabilities,
        ];
      },
    },
  });

  const decision = await orchestrator.orchestrate(
    message,
    [{ channel: "web", async write() {} }],
  );

  assert.equal(message.metadata.originalText, "imposta le luci del ufficio rosse");
  assert.equal(body.state.text, "imposta le luci del ufficio rosse");
  assert.match(JSON.stringify(body), /protocollo ragazza in casa/);
  assert.equal(decision.bypassModel, true);
  assert.deepEqual(decision.capabilityIds, ["home-assistant.jev"]);
});

