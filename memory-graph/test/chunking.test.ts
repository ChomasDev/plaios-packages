import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@plaios/sqlite";
import { GraphMemory } from "../src/index.js";
import { splitIntoChunks } from "../src/memory-chunker.js";
import { hybridLexicalScores } from "../src/graph-values.js";

const STORY = "Ieri ad Halloween ero con la Vale, " + "abbiamo ballato e parlato tanto, ".repeat(60) + "poi andiamo in un altro parcheggio e l'ho portata a casa alle 4.";

test("a long story is split into scene-sized chunks without losing words", () => {
  const chunks = splitIntoChunks(STORY);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 1_050));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), STORY.replace(/\s+/g, " "));
});

test("remember keeps the original and recalls its chunks instead", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const memory = new GraphMemory({ database: provider.scope("chunks") });
  await memory.remember({ id: "story", kind: "episodic", content: STORY, createdAt: new Date("2026-11-01"), userId: "thomas", metadata: { title: "Halloween" } });
  const original = await memory.get("story");
  assert.equal(original?.content, STORY);
  const recalled = await memory.recall({ text: "parcheggio Halloween", userId: "thomas", limit: 10 });
  assert.ok(recalled.length > 0);
  assert.ok(recalled.every(({ id }) => id !== "story"));
  assert.ok(recalled.every(({ metadata }) => metadata?.chunkOf === "story"));
  assert.match(String(recalled.find(({ content }) => String(content).includes("Vale"))?.metadata?.title), /Halloween \(parte 1\/\d+\)/);
  await memory.remember({ id: "story", kind: "episodic", content: STORY, createdAt: new Date("2026-11-01"), userId: "thomas" });
  const all = await memory.listNodes({ userId: "thomas" });
  assert.equal(all.filter(({ id }) => id.startsWith("story#chunk-")).length, splitIntoChunks(STORY).length);
});

test("a name prefix and Italian elisions match", () => {
  assert.ok(hybridLexicalScores("cosa sai sulla vale?", "people Valentina").lexical > 0);
  assert.equal(hybridLexicalScores("Einaudi", "conosciuta all'Einaudi").exact, 1);
});

test("recall with reinforce: false leaves weights untouched", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const memory = new GraphMemory({ database: provider.scope("reinforce") });
  await memory.remember({ id: "fact", kind: "semantic", content: "Valentina vive a Montebelluna", createdAt: new Date(), userId: "thomas" });
  await memory.recall({ text: "Valentina", userId: "thomas", reinforce: false });
  assert.equal((await memory.listNodes({ userId: "thomas" })).find(({ id }) => id === "fact")?.weight?.toFixed(3), "1.000");
  await memory.reinforce(["fact"]);
  assert.ok(((await memory.listNodes({ userId: "thomas" })).find(({ id }) => id === "fact")?.weight ?? 0) > 1);
});
