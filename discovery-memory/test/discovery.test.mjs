import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCapabilityDiscovery } from "../dist/src/index.js";

const capability = { manifest: { id: "cli.run-command", version: "1.0.0", name: "run_cli_command", description: "Inspect disk space and operating system", inputSchema: { type: "object" }, tags: ["cli", "local"] }, async execute() { return { ok: true }; } };
test("avoids ordinary-conversation substring matches", async () => { const discovery = new InMemoryCapabilityDiscovery(); await discovery.register(capability); assert.deepEqual(await discovery.discover({ text: "What do you know about me?" }), []); });
test("matches explicit request tokens and tags", async () => { const discovery = new InMemoryCapabilityDiscovery(); await discovery.register(capability); assert.deepEqual((await discovery.discover({ text: "check disk space", tags: ["cli"] })).map(({ id }) => id), ["cli.run-command"]); });
test("returns the current catalog for an empty orchestrator query", async () => { const discovery = new InMemoryCapabilityDiscovery(); await discovery.register(capability); assert.deepEqual((await discovery.discover()).map(({ id }) => id), ["cli.run-command"]); });
