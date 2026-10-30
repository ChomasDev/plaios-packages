import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@plaios/sqlite";
import { PatternPredictorAdapter, askCron, localTime, recurringSlot } from "../dist/src/index.js";

const at = (iso) => localTime(new Date(iso), "Europe/Rome");

test("finds a habit that wraps midnight and needs three different days", () => {
  const slot = recurringSlot([
    at("2026-09-08T21:58:00Z"), // Tue 23:58
    at("2026-09-09T22:03:00Z"), // Thu 00:03
    at("2026-09-10T22:01:00Z"), // Fri 00:01
    at("2026-09-11T10:00:00Z"), // Fri 12:00, outside the window
  ], 3, 30);
  assert.equal(slot.days, 3);
  assert.ok(slot.minute <= 2 || slot.minute >= 1438, `minute ${slot.minute}`);
  assert.deepEqual(slot.weekdays, [1, 2, 3, 4, 5]);

  // Three messages, but two on the same local day.
  assert.equal(recurringSlot([at("2026-09-08T21:50:00Z"), at("2026-09-08T21:58:00Z"), at("2026-09-09T22:01:00Z")], 3, 30), undefined);
});

test("asks a few minutes early and shifts weekdays when that crosses midnight", () => {
  assert.equal(askCron(1, [1, 2, 3, 4, 5], 5), "56 23 * * 0,1,2,3,4");
  assert.equal(askCron(8 * 60, [0, 1, 2, 3, 4, 5, 6], 5), "55 7 * * *");
});

function fixture() {
  const tasks = new Map();
  const scheduler = {
    validate: (expression) => expression.trim().split(/\s+/).length === 5,
    schedule: (expression, callback, options) => {
      tasks.set(options.name, { expression, callback });
      return { destroy() { tasks.delete(options.name); } };
    },
  };
  const history = [
    ["2026-09-07T22:01:00Z", "spegni la luce"],
    ["2026-09-09T21:57:00Z", "spegni tutte le luci"],
    ["2026-09-10T22:04:00Z", "luci off"],
    ["2026-09-10T08:00:00Z", "che tempo fa?"],
    ["2026-09-10T22:00:00Z", "[Scheduled job]", "cronjob"],
  ].map(([createdAt, content, channel = "telegram"], index) => ({
    id: `chat-user-${index}`,
    kind: "working",
    content,
    createdAt: new Date(createdAt),
    userId: "thomas",
    metadata: { namespace: "chat-history", role: "user", channel },
  }));
  const memory = {
    async recall() { return [...history].reverse(); },
  };
  const prompts = [];
  const system2 = {
    async functionCall(input, definition) {
      prompts.push(input);
      if (definition.name === "report_matches") return { arguments: { messages: [1, 2, 4] } };
      return { arguments: { patterns: [
        { key: "Lights Off Night", description: "spegni la luce", actionPrompt: "Spegni tutte le luci.", messages: [1, 2, 4] },
        { key: "weather", description: "che tempo fa", actionPrompt: "Dimmi il meteo.", messages: [3] },
      ] } };
    },
    async ask() { return { done: { noul: 0 } }; },
  };
  let now = new Date("2026-09-11T21:55:00Z");
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const adapter = new PatternPredictorAdapter({
    database: provider.scope("pattern-predictor"),
    memory,
    system2,
    scheduler,
    userId: "thomas",
    outputChannel: "telegram",
    clock: () => now,
  });
  return { adapter, tasks, prompts, provider, setNow: (iso) => { now = new Date(iso); } };
}

test("learns a habit once, asks before the usual time once a day, and stops when dismissed", async () => {
  const { adapter, tasks, prompts, provider, setNow } = fixture();
  const messages = [];
  const listening = adapter.start(async (message) => messages.push(message));
  await new Promise((resolve) => setImmediate(resolve));

  await adapter.analyze();
  const predictions = await adapter.analyze();
  assert.equal(predictions.length, 1, "deduplicated by key, weather is a one-off");
  assert.equal(predictions[0].key, "lights-off-night");
  assert.doesNotMatch(prompts[0], /Scheduled job/);
  assert.match(prompts[1], /lights-off-night: spegni la luce/);

  const task = tasks.get(predictions[0].id);
  assert.match(task.expression, /^5\d 23 \* \* /);
  await task.callback();
  await task.callback();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].metadata.preferredOutputChannel, "telegram");
  assert.equal(messages[0].metadata.proactive, true);
  assert.equal(messages[0].userId, "thomas");
  assert.match(messages[0].text, /Do not do it yet/);

  const dismissed = await adapter.execute({ action: "dismiss", idOrKey: "lights-off-night" }, { callId: "t" });
  assert.equal(dismissed.data.prediction.status, "dismissed");
  assert.equal(tasks.has(predictions[0].id), false);
  setNow("2026-09-12T21:55:00Z");
  assert.equal(await adapter.ask("lights-off-night"), false);

  await adapter.stop();
  await listening;
  await provider.close();
});

test("mutes a prediction after three unanswered questions", async () => {
  const { adapter, provider, setNow } = fixture();
  const messages = [];
  const listening = adapter.start(async (message) => messages.push(message));
  await new Promise((resolve) => setImmediate(resolve));
  await adapter.analyze();

  for (const day of [12, 13, 14, 15]) {
    setNow(`2026-09-${day}T21:55:00Z`);
    await adapter.ask("lights-off-night");
  }
  assert.equal(messages.length, 3);
  assert.equal((await adapter.listPredictions())[0].status, "muted");

  await adapter.stop();
  await listening;
  await provider.close();
});

test("adds, checks and removes predictions through the capability", async () => {
  const { adapter, tasks, provider } = fixture();
  const listening = adapter.start(async () => {});
  await new Promise((resolve) => setImmediate(resolve));
  const none = { idOrKey: null, description: null, actionPrompt: null, time: null, weekdays: null };

  const added = await adapter.execute({ ...none, action: "add", description: "idee per i video", actionPrompt: "Proponi tre idee video.", time: "22:15", weekdays: "1-5" }, { callId: "t" });
  assert.equal(added.success, true);
  assert.equal(added.data.prediction.key, "idee-per-i-video");
  assert.deepEqual(added.data.prediction.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(tasks.get(added.data.prediction.id).expression, "10 22 * * 1,2,3,4,5");
  assert.equal((await adapter.execute({ ...none, action: "add", description: "x", actionPrompt: "x", time: "25:00" }, { callId: "t" })).success, false);

  const checked = await adapter.check("spegnere la luce");
  assert.deepEqual([checked.days, checked.slotDays, checked.qualifies], [3, 3, true]);

  const removed = await adapter.execute({ ...none, action: "remove", idOrKey: "idee-per-i-video" }, { callId: "t" });
  assert.equal(removed.success, true);
  assert.equal(tasks.has(added.data.prediction.id), false);
  assert.equal((await adapter.listPredictions()).length, 0);

  await adapter.stop();
  await listening;
  await provider.close();
});
