import assert from "node:assert/strict";
import test from "node:test";
import type { Database, Memory } from "@plaios/core/domain";
import { SQLiteDatabaseProvider } from "@plaios/sqlite";
import {
  GraphMemory,
  MemoryEdgeType,
  MemoryNodeType,
} from "../src/index.js";
import { buildThreeGraphData } from "../src/graph-view-model.js";

test("builds a mutation-safe 3D graph model and drops orphaned links", () => {
  const sourceNodes = [
    { id: "person", type: "people", label: "Ada", weight: 1 },
    { id: "project", type: "project", label: "AgentOS", weight: 4 },
  ];
  const model = buildThreeGraphData(sourceNodes, [
    { id: "valid", sourceId: "person", targetId: "project", type: "builds", weight: 0.8 },
    { id: "orphan", sourceId: "person", targetId: "missing", type: "knows", weight: 0.5 },
  ]);

  assert.equal(model.nodes.length, 2);
  assert.equal(model.links.length, 1);
  assert.equal(model.links[0]?.source, "person");
  assert.equal(model.links[0]?.target, "project");
  assert.notEqual(model.nodes[0], sourceNodes[0]);
  assert.match(model.nodes[0]!.color, /^#/);
});

test("is a drop-in Memory and creates typed people and hobby nodes", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("graph-test"), traversalDepth: 2 });
  const memory: Memory = graph;

  await memory.remember({
    id: "memory-alice",
    kind: "episodic",
    content: {
      people: [{ name: "Alice Chen", role: "designer", hobbies: ["rock climbing"] }],
      note: "We discussed the mobile redesign.",
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    addedMemoryDate: new Date("2026-01-02T00:00:00Z"),
    factDate: new Date("2025-12-20T00:00:00Z"),
    userId: "user-1",
  });

  const aliceResults = await memory.recall({ text: "Alice", userId: "user-1", limit: 10 });
  assert.ok(aliceResults.some((entry) => entry.metadata?.graphNodeType === MemoryNodeType.Person));
  assert.ok(aliceResults.some((entry) => entry.id === "memory-alice"));
  const storedMemory = await memory.get("memory-alice");
  assert.equal(storedMemory?.addedMemoryDate?.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.equal(storedMemory?.factDate?.toISOString(), "2025-12-20T00:00:00.000Z");

  const climbingResults = await memory.recall({ text: "rock climbing", userId: "user-1", limit: 10 });
  const hobby = climbingResults.find((entry) => entry.metadata?.graphNodeType === MemoryNodeType.Hobby);
  assert.equal((hobby?.content as { label?: string }).label, "rock climbing");
  assert.ok(climbingResults.some((entry) => entry.metadata?.graphNodeType === MemoryNodeType.Person));

  const person = aliceResults.find((entry) => entry.metadata?.graphNodeType === MemoryNodeType.Person)!;
  const neighbors = await graph.neighbors(person.id, 1);
  assert.ok(neighbors.some((node) => node.type === MemoryNodeType.Hobby));
  assert.ok(neighbors.some((node) => node.id === "memory-alice"));
  await provider.close();
});

test("reinforces recalled memories and decays their weight over time", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  let now = new Date("2026-01-01T00:00:00Z");
  const graph = new GraphMemory({
    database: provider.scope("weight-test"),
    accessBoost: 1,
    halfLifeMs: 1_000,
    now: () => new Date(now),
  });
  await graph.remember({ id: "weighted", kind: "semantic", content: "coffee", createdAt: now, importance: 1 });

  assert.equal((await graph.get("weighted"))?.importance, 1);
  assert.equal((await graph.get("weighted"))?.importance, 2);
  now = new Date(now.getTime() + 1_000);
  assert.equal((await graph.get("weighted"))?.importance, 1.5);
  await provider.close();
});

test("supports custom node types and weighted many-to-many links", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("custom-test") });
  await graph.upsertNode({ id: "person-a", type: MemoryNodeType.Person, label: "Ada", data: { language: "English" } });
  await graph.upsertNode({ id: "recipe-a", type: "recipe", label: "Tiramisu", data: { cuisine: "Italian" } });
  await graph.link({ sourceId: "person-a", targetId: "recipe-a", type: MemoryEdgeType.RelatedTo, weight: 0.8 });

  assert.deepEqual((await graph.neighbors("person-a")).map((node) => node.id), ["recipe-a"]);
  assert.equal((await graph.recall({ text: "Tiramisu" }))[0]?.metadata?.graphNodeType, "recipe");
  await provider.close();
});

test("exposes a user-scoped capability for writing graph nodes and relationships", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("capability-write-test") });

  const result = await graph.execute({
    nodes: [
      { ref: "valentina", type: "people", label: "Valentina Brisolin", attributes: [{ key: "description", value: "mysterious" }], weight: null, factDate: null },
      { ref: "alex", type: "people", label: "Alex", attributes: [], weight: null, factDate: null },
      { ref: "martina", type: "people", label: "Martina", attributes: [], weight: null, factDate: null },
      { ref: "federico", type: "people", label: "Federico", attributes: [], weight: null, factDate: null },
    ],
    edges: [
      { sourceRef: "valentina", targetRef: "alex", type: "friend-of", weight: null },
      { sourceRef: "valentina", targetRef: "martina", type: "friend-of", weight: null },
      { sourceRef: "valentina", targetRef: "federico", type: "friend-of", weight: null },
    ],
  }, {
    runId: "run-1",
    callId: "call-1",
    userId: "telegram-user",
    sessionId: "telegram-chat",
    startedAt: new Date(),
    metadata: { channel: "telegram", inputMessageId: "message-1" },
  });

  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.nodes.length, 4);
  assert.equal(result.data.edges.length, 3);
  assert.equal(graph.manifest.id, "memory.graph.write");

  const results = await graph.recall({ text: "Valentina Brisolin", userId: "telegram-user", limit: 10 });
  const valentina = results.find((entry) => entry.id === result.data.nodes[0]?.id);
  assert.equal(valentina?.metadata?.graphNodeType, MemoryNodeType.Person);
  assert.equal((valentina?.content as { description?: string }).description, "mysterious");
  const neighbors = await graph.neighbors(result.data.nodes[0]!.id, 1);
  assert.deepEqual(new Set(neighbors.map(({ label }) => label)), new Set(["Alex", "Martina", "Federico"]));

  await provider.close();
});

test("rejects graph-write relationships whose endpoints are not in the request", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("capability-validation-test") });
  const result = await graph.execute({
    nodes: [
      { ref: "valentina", type: "people", label: "Valentina", attributes: [], weight: null, factDate: null },
    ],
    edges: [
      { sourceRef: "valentina", targetRef: "missing", type: "friend-of", weight: null },
    ],
  }, {
    runId: "run-1",
    callId: "call-1",
    userId: "telegram-user",
    startedAt: new Date(),
  });

  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.code, "VALIDATION_ERROR");
  await provider.close();
});

test("rejects edge weights that traversal cannot consume", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("edge-weight-test") });
  await graph.upsertNode({ id: "left", type: "topic", label: "Left", data: {} });
  await graph.upsertNode({ id: "right", type: "topic", label: "Right", data: {} });

  await assert.rejects(
    graph.link({ sourceId: "left", targetId: "right", type: "related-to", weight: 1.1 }),
    /edge weight must be between 0 and 1/,
  );
  await provider.close();
});

test("uses vector candidates without globally scanning nodes", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const base = provider.scope("vector-test");
  let selectedId = "";
  const database = new Proxy(base, {
    get(target, property, receiver) {
      if (property !== "get") return Reflect.get(target, property, receiver);
      return (table: string, query?: unknown) => {
        if (table === "nodes" && typeof query === "object" && query !== null && !("where" in query)) {
          throw new Error("global node scan");
        }
        return (target.get as (table: string, query?: unknown) => unknown).call(target, table, query);
      };
    },
  }) as Database;
  const graph = new GraphMemory({
    database,
    vectorStore: {
      async upsert(id) { selectedId = id; },
      async query() { return [{ id: selectedId, score: 0.95 }]; },
      async remove() {},
    },
  });
  await graph.remember({ id: "vector-memory", kind: "semantic", content: "A semantic fact", createdAt: new Date() });

  assert.equal((await graph.recall({ text: "unrelated embedding query", limit: 1 }))[0]?.id, "vector-memory");
  await provider.close();
});

test("penalizes hub traversal so specific project relations rank first", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("hub-test"), traversalDepth: 2 });
  await graph.upsertNode({ id: "project", type: "project", label: "Go2Match", data: {} });
  await graph.upsertNode({ id: "owner", type: MemoryNodeType.Person, label: "Thomas", data: {} });
  await graph.upsertNode({ id: "stripe", type: "technology", label: "Stripe Connect", data: {} });
  await graph.upsertNode({ id: "nexi", type: "technology", label: "Nexi", data: {} });
  await graph.link({ sourceId: "project", targetId: "owner", type: "created-by" });
  await graph.link({ sourceId: "project", targetId: "stripe", type: "uses" });
  await graph.link({ sourceId: "owner", targetId: "nexi", type: "has-experience-with" });

  const results = await graph.recall({ text: "Go2Match", limit: 4 });
  const stripe = results.findIndex((entry) => entry.id === "stripe");
  const nexi = results.findIndex((entry) => entry.id === "nexi");
  assert.ok(stripe >= 0);
  assert.ok(nexi === -1 || stripe < nexi);
  await provider.close();
});

test("hybrid fusion keeps an exact Italian entity match above noisy vectors", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({
    database: provider.scope("hybrid-fusion-test"),
    embeddingProvider: {
      async embed(texts) {
        return texts.map((text) =>
          text.includes("Alessia e la terza stagione") ? [0, 1] : [1, 0]
        );
      },
    },
  });

  for (let index = 0; index < 40; index += 1) {
    await graph.remember({
      id: `vector-noise-${index}`,
      kind: "semantic",
      content: `Unrelated vector result ${index}`,
      createdAt: new Date(2026, 0, index + 1),
      userId: "thomas",
    });
  }
  await graph.upsertNode({
    id: "life-arc-alessia",
    type: "event",
    label: "Alessia e la terza stagione",
    data: {},
    kind: "semantic",
    userId: "thomas",
  });

  const results = await graph.recall({
    text: "Conversation supplied through an OpenRouter-compatible API: USER: Cosa sai su Alessia?",
    userId: "thomas",
    limit: 5,
  });

  assert.equal(results[0]?.id, "life-arc-alessia");
  await provider.close();
});

test("exposes a live graph management bridge", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("bridge-test") });

  let data = await graph.microfrontendData();
  assert.equal(data.available, true);
  assert.equal(data.totalNodes, 0);

  data = await data.actions!.remember({ content: "Alice enjoys rock climbing", userId: "alice" });
  assert.ok(data.totalNodes >= 1);
  assert.ok(data.nodes.some(({ label }) => label.includes("Alice enjoys rock climbing")));

  data = await (await graph.microfrontendData()).actions!.clear();
  assert.equal(data.totalNodes, 0);
  await provider.close();
});

test("stores protocol nodes and lists them by type", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const graph = new GraphMemory({ database: provider.scope("protocol-test") });
  await graph.upsertNode({
    id: "",
    type: MemoryNodeType.Protocol,
    label: "protocollo agentos",
    data: {
      trigger: "protocollo agentos",
      expansion: "Apri http://100.103.217.8:3100 sul Mac",
      url: "http://100.103.217.8:3100",
    },
    kind: "procedural",
    userId: "thomas",
    metadata: { namespace: "protocol" },
  });

  const protocols = await graph.listNodes({ type: MemoryNodeType.Protocol, userId: "thomas" });
  assert.equal(protocols.length, 1);
  assert.equal(protocols[0]?.type, MemoryNodeType.Protocol);
  assert.equal(protocols[0]?.label, "protocollo agentos");
  assert.equal((protocols[0]?.data as { url?: string }).url, "http://100.103.217.8:3100");
  await provider.close();
});
