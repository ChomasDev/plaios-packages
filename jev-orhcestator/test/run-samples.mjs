import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CompositeEnvironment } from "@agent-os/env-node";
import { JevOrhcestatorOrchestrator } from "../dist/src/index.js";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const env = new CompositeEnvironment({ cwd: projectRoot });

const orchestrator = new JevOrhcestatorOrchestrator({
  cwd: projectRoot,
  capabilityDiscovery: {
    async discover() {
      return [
        {
          id: "home-assistant.control",
          name: "control_home_assistant",
          description: "Control smart home devices",
          inputSchema: {},
        },
        {
          id: "memory.retrieval",
          name: "memory_retrieval",
          description: "Retrieve stored memories",
          inputSchema: {},
        },
        {
          id: "web.search",
          name: "search_web",
          description: "Search the web",
          inputSchema: {},
        },
      ];
    },
  },
});

const outputs = [
  { channel: "web", async write() {} },
  { channel: "telegram", async write() {} },
];

console.log(`Loaded env from ${projectRoot}`);
console.log(`JEV_API_KEY: ${env.get("JEV_API_KEY") ? "set" : "missing"}`);

const samples = [
  { channel: "web", text: "turn on the light" },
  { channel: "web", text: "hello" },
  { channel: "web", text: "Mandami un messaggio su Telegram" },
];

for (const sample of samples) {
  const decision = await orchestrator.orchestrate(
    {
      id: randomUUID(),
      channel: sample.channel,
      text: sample.text,
      createdAt: new Date(),
    },
    outputs,
  );

  console.log(`\nInput (${sample.channel}): ${sample.text}`);
  console.log(JSON.stringify(decision, null, 2));
}
