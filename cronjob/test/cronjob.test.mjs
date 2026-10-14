import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@agent-os/sqlite";
import { CronjobAdapter } from "../dist/src/index.js";

function fixture() {
  const callbacks = [];
  const scheduler = {
    validate: (expression) => expression.trim().split(/\s+/).length === 5,
    schedule: (_expression, callback) => {
      callbacks.push(callback);
      return { destroy() {} };
    },
  };
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const adapter = new CronjobAdapter({
    database: provider.scope("cronjob"),
    scheduler,
    defaultTimezone: "Europe/Rome",
    preferredOutputChannel: "telegram",
    userId: "thomas",
  });
  return { adapter, callbacks, provider };
}

test("the live input and management capability share one scheduler", async () => {
  const { adapter, callbacks, provider } = fixture();
  const messages = [];
  const listening = adapter.start(async (message) => messages.push(message));
  await new Promise((resolve) => setImmediate(resolve));

  const added = await adapter.execute({
    action: "add",
    idOrName: null,
    name: "weekday-brief",
    cronExpression: "0 9 * * 1-5",
    prompt: "Create the weekday brief",
    timezone: null,
    preferredOutputChannel: null,
  }, { callId: "test", userId: "thomas" });

  assert.equal(added.success, true);
  assert.equal(callbacks.length, 1);
  await callbacks[0]();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].metadata.preferredOutputChannel, "telegram");
  assert.equal(messages[0].userId, "thomas");

  await adapter.stop();
  await listening;
  await provider.close();
});

test("rejects second-level schedules by default and persists lifecycle changes", async () => {
  const { adapter, provider } = fixture();
  const invalid = await adapter.execute({
    action: "add",
    idOrName: null,
    name: "too-fast",
    cronExpression: "*/5 * * * * *",
    prompt: "Run too often",
    timezone: null,
    preferredOutputChannel: null,
  }, { callId: "test", userId: "thomas" });
  assert.equal(invalid.success, false);

  await adapter.addCronjob({
    name: "daily",
    cronExpression: "0 9 * * *",
    prompt: "Daily status",
  });
  await adapter.suspendCronjob("daily");
  assert.equal((await adapter.listCronjobs())[0].status, "suspended");
  await adapter.resumeCronjob("daily");
  assert.equal((await adapter.listCronjobs())[0].status, "active");
  await adapter.removeCronjob("daily");
  assert.equal((await adapter.listCronjobs()).length, 0);

  await adapter.close();
  await provider.close();
});
