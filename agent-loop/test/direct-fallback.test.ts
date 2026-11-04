import assert from "node:assert/strict";
import test from "node:test";
import type { Capability, CapabilityDiscovery } from "@plaios/core/domain";
import { DefaultAgentLoop } from "../src/index.js";

test("a failed direct capability falls back to the generative model with the same capability", async () => {
  const capability = {
    manifest: { id: "home-assistant.jev", name: "control_home_assistant_jev", description: "", inputSchema: { type: "object" } },
    async execute() {
      return { success: false, error: { code: "NO_DEVICE_MATCH", message: "Non ho capito a quale dispositivo ti riferisci.", retryable: false } };
    },
  } as unknown as Capability;
  const offered: string[] = [];
  const model = {
    async processWithFunctions(_input: unknown, functions: Array<{ name: string }>) {
      offered.push(...functions.map(({ name }) => name));
      return { type: "text", text: "Cosa vuoi che spenga?" };
    },
    async processInput() {
      throw new Error("unexpected");
    },
  };
  const capabilityDiscovery = {
    async get(id: string) {
      return id === capability.manifest.id ? capability : undefined;
    },
  } as unknown as CapabilityDiscovery;
  const loop = new DefaultAgentLoop({ model, capabilityDiscovery, alwaysCapabilityIds: [] } as never);
  const response = await loop.run({ id: "m", channel: "telegram", sessionId: "s", text: "Spegnile", createdAt: new Date() }, { capabilityIds: ["home-assistant.jev"], stream: false, bypassModel: true });
  assert.deepEqual(response, { type: "text", text: "Cosa vuoi che spenga?" });
  assert.deepEqual(offered, ["control_home_assistant_jev"]);
});
