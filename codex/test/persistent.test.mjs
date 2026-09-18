import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CodexProvider } from "../dist/src/index.js";

test("reuses one Codex app-server process across requests", async () => {
  const provider = new CodexProvider({
    model: "test-model",
    workingDirectory: process.cwd(),
    codexPathOverride: fileURLToPath(new URL("./fixtures/fake-app-server.mjs", import.meta.url)),
  });

  try {
    assert.deepEqual(await provider.processInput("first"), { type: "text", text: "process-turn-1" });
    assert.deepEqual(await provider.processInput("second"), { type: "text", text: "process-turn-2" });
    assert.equal(provider.microfrontendData().persistentProcess, true);
  } finally {
    await provider.close();
  }
});
