import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SQLiteDatabaseProvider } from "../dist/src/index.js";

const structure = {
  tables: {
    pages: {
      primaryKey: "id",
      columns: {
        id: { type: "string", required: true },
        title: { type: "string", required: true },
        visits: { type: "number", default: 0 },
        live: { type: "boolean", default: false },
        data: { type: "json" },
        createdAt: { type: "datetime" },
      },
      indexes: [{ columns: ["title"] }],
    },
  },
};

test("provides namespaced typed CRUD", async () => {
  const provider = new SQLiteDatabaseProvider({ databasePath: ":memory:" });
  const web = provider.scope("web");
  const auth = provider.scope("auth");
  await Promise.all([web.init(structure), auth.init(structure)]);

  const createdAt = new Date("2026-01-02T03:04:05.000Z");
  await web.add("pages", {
    id: "one",
    title: "Agent OS",
    live: true,
    data: { published: true },
    createdAt,
  });
  await auth.add("pages", { id: "one", title: "Login", visits: 2 });

  assert.equal((await web.get("pages", "one")).title, "Agent OS");
  assert.equal((await auth.get("pages", "one")).title, "Login");
  assert.deepEqual((await web.get("pages", "one")).data, { published: true });
  assert.equal((await web.get("pages", "one")).live, true);
  assert.equal((await web.get("pages", "one")).createdAt.toISOString(), createdAt.toISOString());

  const updated = await web.update("pages", "one", { visits: 3 });
  assert.equal(updated.visits, 3);
  assert.equal((await web.get("pages", { where: { visits: 3 }, offset: 0 })).length, 1);
  assert.equal(await web.delete("pages", "one"), 1);
  assert.equal(await web.get("pages", "one"), undefined);
  await provider.close();
});

test("persists to disk and exposes a guarded admin API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-os-sqlite-"));
  const databasePath = join(directory, "data", "agent.sqlite");
  const provider = new SQLiteDatabaseProvider({ databasePath });
  try {
    const database = provider.scope("catalog");
    await database.init(structure);
    await database.add("pages", { id: "home", title: "Home" });

    const tables = await provider.admin.listTables();
    assert.deepEqual(tables.map(({ name, rowCount }) => ({ name, rowCount })), [
      { name: "catalog__pages", rowCount: 1 },
    ]);

    const details = await provider.admin.describeTable("catalog__pages");
    assert.equal(details.columns.find((column) => column.name === "id").primaryKeyPosition, 1);
    assert.ok(details.indexes.some((index) =>
      index.name === "catalog_pages_0" && index.columns.includes("title")
    ));

    const page = await provider.admin.browseTable("catalog__pages", { limit: 25 });
    assert.equal(page.total, 1);
    assert.equal(page.rows[0].title, "Home");

    const read = await provider.admin.execute(
      "SELECT title FROM catalog__pages WHERE id = 'home'",
    );
    assert.equal(read.kind, "rows");
    assert.equal(read.rows[0].title, "Home");

    await assert.rejects(
      () => provider.admin.execute("DELETE FROM catalog__pages"),
      /Confirm write access/,
    );
    const write = await provider.admin.execute(
      "DELETE FROM catalog__pages WHERE id = 'home'",
      { allowWrite: true },
    );
    assert.equal(write.changes, 1);
  } finally {
    await provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
