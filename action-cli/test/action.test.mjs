import assert from "node:assert/strict";
import test from "node:test";
import { RunCLICommandCapability } from "../dist/src/index.js";

const env = { getAll: () => ({ PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: "must-not-be-forwarded" }) };
const context = { runId: "run-1", callId: "call-1", startedAt: new Date() };

test("runs safe workspace inspection without a shell", async () => {
  const action = new RunCLICommandCapability({ env, cwd: process.cwd() });
  const result = await action.execute({ command: "find", args: [".", "-maxdepth", "0"] }, context);
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.stdout, ".");
  assert.equal(action.microfrontendData().secretEnvironmentForwarded, false);
});

test("rejects mutation, external paths, and process environment flags", async () => {
  const action = new RunCLICommandCapability({ env, cwd: process.cwd() });
  for (const input of [
    { command: "find", args: [".", "-delete"] },
    { command: "find", args: ["/home", "-name", "secret"] },
    { command: "ps", args: ["auxe"] },
  ]) {
    const result = await action.execute(input, context);
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.code, "ARGUMENT_NOT_ALLOWED");
  }
});

test("advertises the configured allowlist and still enforces it", async () => {
  const action = new RunCLICommandCapability({ env, allowedCommands: "echo,ssh" });
  assert.match(action.manifest.inputSchema.properties.command.description, /Allowed: echo, ssh\./);
  const result = await action.execute({ command: "rm", args: ["x"] }, context);
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.code, "COMMAND_NOT_ALLOWED");
});
