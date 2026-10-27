import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  Database,
  DatabaseKey,
  DatabaseProvider,
  DatabaseQuery,
  DatabaseRecord,
  DatabaseStructure,
  DatabaseTableSchema,
} from "@agent-os/core";

import { SQLiteDatabaseAdmin, type SQLiteExecuteOptions } from "./admin.js";
import {
  applyDefaults,
  normalizeNamespace,
  quote,
  safeIdentifier,
  sqliteType,
  validateStructure,
} from "./schema.js";

export interface SQLiteDatabaseOptions {
  databasePath?: string;
  cwd?: string;
  enableForeignKeys?: boolean;
}

export class SQLiteDatabaseProvider implements DatabaseProvider {
  private readonly connection: DatabaseSync;
  private readonly schemas = new Map<string, DatabaseTableSchema>();
  readonly databasePath: string;
  readonly admin: SQLiteDatabaseAdmin;

  constructor(options: SQLiteDatabaseOptions = {}) {
    this.databasePath = resolvePath(options.databasePath, options.cwd);
    if (this.databasePath !== ":memory:") {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }
    this.connection = new DatabaseSync(this.databasePath);
    this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    if (options.enableForeignKeys ?? true) {
      this.connection.exec("PRAGMA foreign_keys = ON;");
    }
    this.admin = new SQLiteDatabaseAdmin(this.connection);
  }

  scope(namespace: string): Database {
    return new ScopedSQLiteDatabase(
      this.connection,
      normalizeNamespace(namespace),
      this.schemas,
    );
  }

  microfrontendData() {
    return {
      databasePath: this.databasePath,
      admin: {
        listTables: () => this.admin.listTables(),
        describeTable: (table: string) => this.admin.describeTable(table),
        browseTable: (
          table: string,
          options?: { offset?: number; limit?: number },
        ) => this.admin.browseTable(table, options),
        execute: (sql: string, options?: SQLiteExecuteOptions) =>
          this.admin.execute(sql, options),
      },
    };
  }

  async close(): Promise<void> {
    this.connection.close();
  }
}

class ScopedSQLiteDatabase implements Database {
  constructor(
    private readonly connection: DatabaseSync,
    readonly namespace: string,
    private readonly schemas: Map<string, DatabaseTableSchema>,
  ) {}

  async init(structure: DatabaseStructure): Promise<void> {
    validateStructure(structure);
    for (const [table, schema] of Object.entries(structure.tables)) {
      this.createTable(table, schema);
      this.schemas.set(this.key(table), schema);
    }
  }

  async add<T extends DatabaseRecord>(table: string, value: T): Promise<T> {
    const schema = this.schema(table);
    const record = applyDefaults(schema, value);
    const columns = Object.keys(record);
    if (columns.length === 0) {
      throw new Error(`Cannot add an empty record to ${table}`);
    }
    const values = columns.map((key) => encode(record[key], schema.columns[key]!.type));
    const sql = `INSERT INTO ${this.name(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
    this.connection.prepare(sql).run(...values);
    return this.decode(
      schema,
      Object.fromEntries(columns.map((key, index) => [key, values[index]])),
    ) as T;
  }

  async get<T extends DatabaseRecord>(
    table: string,
    target?: DatabaseKey | DatabaseQuery,
  ): Promise<T | undefined | readonly T[]> {
    const schema = this.schema(table);
    if (typeof target === "string" || typeof target === "number") {
      const primaryKey = schema.primaryKey ?? "id";
      const row = this.connection.prepare(
        `SELECT * FROM ${this.name(table)} WHERE ${quote(primaryKey)} = ?`,
      ).get(target);
      return row ? (this.decode(schema, row as DatabaseRecord) as T) : undefined;
    }
    const query = buildQuery(schema, target ?? {});
    const rows = this.connection.prepare(
      `SELECT * FROM ${this.name(table)}${query.sql}`,
    ).all(...query.values);
    return rows.map((row) => this.decode(schema, row as DatabaseRecord) as T);
  }

  async set<T extends DatabaseRecord>(
    table: string,
    id: DatabaseKey,
    value: T,
  ): Promise<T> {
    const schema = this.schema(table);
    const primaryKey = schema.primaryKey ?? "id";
    const record = applyDefaults(schema, { ...value, [primaryKey]: id });
    const columns = Object.keys(record);
    const values = columns.map((key) => encode(record[key], schema.columns[key]!.type));
    const updates = columns
      .filter((key) => key !== primaryKey)
      .map((key) => `${quote(key)}=excluded.${quote(key)}`);
    const conflict = updates.length ? `DO UPDATE SET ${updates.join(",")}` : "DO NOTHING";
    const sql = `INSERT INTO ${this.name(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT(${quote(primaryKey)}) ${conflict}`;
    this.connection.prepare(sql).run(...values);
    return this.decode(
      schema,
      Object.fromEntries(columns.map((key, index) => [key, values[index]])),
    ) as T;
  }

  async update<T extends DatabaseRecord>(
    table: string,
    id: DatabaseKey,
    patch: Partial<T>,
  ): Promise<T | undefined> {
    const current = await this.get<T>(table, id);
    if (!current) return undefined;
    return this.set(table, id, { ...current, ...patch } as T);
  }

  async delete(table: string, target: DatabaseKey | DatabaseQuery): Promise<number> {
    const schema = this.schema(table);
    if (typeof target === "string" || typeof target === "number") {
      const key = schema.primaryKey ?? "id";
      return Number(this.connection.prepare(
        `DELETE FROM ${this.name(table)} WHERE ${quote(key)} = ?`,
      ).run(target).changes);
    }
    const query = buildQuery(schema, target, false);
    return Number(this.connection.prepare(
      `DELETE FROM ${this.name(table)}${query.sql}`,
    ).run(...query.values).changes);
  }

  private createTable(table: string, schema: DatabaseTableSchema): void {
    const primaryKey = schema.primaryKey ?? "id";
    const columns = Object.entries(schema.columns).map(([name, column]) =>
      `${quote(name)} ${sqliteType(column.type)}${name === primaryKey ? " PRIMARY KEY" : ""}${column.required ? " NOT NULL" : ""}${column.unique ? " UNIQUE" : ""}`,
    );
    this.connection.exec(
      `CREATE TABLE IF NOT EXISTS ${this.name(table)} (${columns.join(",")})`,
    );
    for (const [index, definition] of (schema.indexes ?? []).entries()) {
      const name = quote(`${this.namespace}_${table}_${index}`);
      const unique = definition.unique ? "UNIQUE " : "";
      this.connection.exec(
        `CREATE ${unique}INDEX IF NOT EXISTS ${name} ON ${this.name(table)} (${definition.columns.map(quote).join(",")})`,
      );
    }
  }

  private schema(table: string): DatabaseTableSchema {
    const schema = this.schemas.get(this.key(table));
    if (!schema) {
      throw new Error(`Database table is not initialized: ${this.namespace}.${table}`);
    }
    return schema;
  }

  private key(table: string): string {
    return `${this.namespace}.${this.localTable(table)}`;
  }

  private name(table: string): string {
    return quote(`${this.namespace}__${this.localTable(table)}`);
  }

  private localTable(table: string): string {
    const parts = table.split(".");
    if (parts.length === 1) return safeIdentifier(parts[0]!, "table name");
    if (parts.length === 2 && normalizeNamespace(parts[0]!) === this.namespace) {
      return safeIdentifier(parts[1]!, "table name");
    }
    throw new Error(`Table ${table} is outside database namespace ${this.namespace}`);
  }

  private decode(
    schema: DatabaseTableSchema,
    row: DatabaseRecord,
  ): DatabaseRecord {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        decode(value, schema.columns[key]?.type),
      ]),
    );
  }
}

function buildQuery(
  schema: DatabaseTableSchema,
  query: DatabaseQuery,
  includePaging = true,
): { sql: string; values: SQLInputValue[] } {
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  for (const [field, value] of Object.entries(query.where ?? {})) {
    if (!schema.columns[field]) throw new Error(`Unknown database field: ${field}`);
    clauses.push(value === null ? `${quote(field)} IS NULL` : `${quote(field)} = ?`);
    if (value !== null) values.push(encode(value, schema.columns[field]!.type));
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const order = (query.orderBy ?? []).map(({ field, direction }) => {
    if (!schema.columns[field]) throw new Error(`Unknown database field: ${field}`);
    return `${quote(field)} ${direction === "desc" ? "DESC" : "ASC"}`;
  });
  if (!includePaging) return { sql: where, values };
  const ordering = order.length ? ` ORDER BY ${order.join(",")}` : "";
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = query.limit === undefined
    ? (offset > 0 ? " LIMIT -1" : "")
    : ` LIMIT ${Math.max(0, Math.trunc(query.limit))}`;
  const paging = offset > 0 ? `${limit} OFFSET ${offset}` : limit;
  return { sql: `${where}${ordering}${paging}`, values };
}

function encode(value: unknown, type: string): SQLInputValue {
  if (value === null || value === undefined) return null;
  if (type === "json") return JSON.stringify(value);
  if (type === "datetime") {
    return value instanceof Date ? value.toISOString() : String(value);
  }
  if (type === "boolean") return value ? 1 : 0;
  return value as SQLInputValue;
}

function decode(value: unknown, type?: string): unknown {
  if (value === null || value === undefined) return value;
  if (type === "json") return JSON.parse(String(value));
  if (type === "datetime") return new Date(String(value));
  if (type === "boolean") return Boolean(value);
  return value;
}

function resolvePath(
  path = ".agent-os/agent-os.sqlite",
  cwd = process.cwd(),
): string {
  return path === ":memory:" ? path : resolve(cwd, path);
}
