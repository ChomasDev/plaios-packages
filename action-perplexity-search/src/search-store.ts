import type { Database } from "@plaios/core/domain";

import type { PerplexitySearchResultItem } from "./index.js";

export interface StoredSearch { id: string; query: string; results: PerplexitySearchResultItem[]; createdAt: string }

const TABLE = "searches";
const KEEP = 200;

/**
 * Keeps recent searches so a WebSources card can show them again, also in old conversations after a restart.
 * Without a database it falls back to memory (lost on restart).
 */
export class SearchStore {
  private readonly memory = new Map<string, StoredSearch>();
  private ready?: Promise<void>;

  constructor(private readonly database?: Database) {}

  async save(search: StoredSearch): Promise<void> {
    if (!this.database) return this.remember(search);
    await this.init();
    await this.database.set(TABLE, search.id, { ...search });
    const stale = await this.database.get<StoredSearch & Record<string, unknown>>(TABLE, { orderBy: [{ field: "createdAt", direction: "desc" }], offset: KEEP });
    await Promise.all(stale.map((row) => this.database!.delete(TABLE, row.id)));
  }

  async find(id: string): Promise<StoredSearch | undefined> {
    if (!this.database) return this.memory.get(id);
    await this.init();
    return this.database.get<StoredSearch & Record<string, unknown>>(TABLE, id);
  }

  private remember(search: StoredSearch): void {
    this.memory.set(search.id, search);
    for (const key of [...this.memory.keys()].slice(0, Math.max(0, this.memory.size - 50))) this.memory.delete(key);
  }

  private init(): Promise<void> {
    this.ready ??= this.database!.init({
      tables: {
        [TABLE]: {
          primaryKey: "id",
          columns: { id: { type: "string", required: true }, query: { type: "string", required: true }, results: { type: "json", required: true }, createdAt: { type: "datetime", required: true } },
          indexes: [{ columns: ["createdAt"] }],
        },
      },
    });
    return this.ready;
  }
}
