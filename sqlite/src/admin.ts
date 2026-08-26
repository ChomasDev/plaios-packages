import type { DatabaseSync, StatementResultingChanges } from "node:sqlite";

export interface SQLiteTableSummary {
  name: string;
  namespace?: string;
  localName: string;
  rowCount: number;
}

export interface SQLiteColumnInfo {
  position: number;
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  primaryKeyPosition: number;
}

export interface SQLiteIndexInfo {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: readonly string[];
}

export interface SQLiteTableDetails {
  table: SQLiteTableSummary;
  createSql: string | null;
  columns: readonly SQLiteColumnInfo[];
  indexes: readonly SQLiteIndexInfo[];
}

export interface SQLitePage {
  table: string;
  columns: readonly string[];
  rows: readonly Record<string, unknown>[];
  offset: number;
  limit: number;
  total: number;
}

export interface SQLiteQueryResult {
  kind: "rows" | "changes";
  columns: readonly string[];
  rows: readonly Record<string, unknown>[];
  changes: number;
  lastInsertRowid?: number | string;
  durationMs: number;
}

export interface SQLiteExecuteOptions {
  allowWrite?: boolean;
  maxRows?: number;
}

export interface SQLiteAdminClient {
  listTables(): Promise<readonly SQLiteTableSummary[]>;
  describeTable(table: string): Promise<SQLiteTableDetails>;
  browseTable(table: string, options?: { offset?: number; limit?: number }): Promise<SQLitePage>;
  execute(sql: string, options?: SQLiteExecuteOptions): Promise<SQLiteQueryResult>;
}

interface SQLiteSchemaRow {
  name: string;
  sql: string | null;
}

interface SQLiteCountRow { count: number; }
interface SQLiteColumnRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface SQLiteIndexRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}
interface SQLiteIndexColumnRow { name: string | null; }

export class SQLiteDatabaseAdmin implements SQLiteAdminClient {
  constructor(private readonly connection: DatabaseSync) {}

  async listTables(): Promise<readonly SQLiteTableSummary[]> {
    const tables = this.connection.prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as unknown as SQLiteSchemaRow[];

    return tables.map(({ name }) => {
      const row = this.connection.prepare(
        `SELECT COUNT(*) AS count FROM ${quote(name)}`,
      ).get() as unknown as SQLiteCountRow;
      const separator = name.indexOf("__");
      return {
        name,
        namespace: separator > 0 ? name.slice(0, separator) : undefined,
        localName: separator > 0 ? name.slice(separator + 2) : name,
        rowCount: Number(row.count),
      };
    });
  }

  async describeTable(table: string): Promise<SQLiteTableDetails> {
    const summary = await this.requireTable(table);
    const schema = this.connection.prepare(
      "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
    ).get(table) as unknown as SQLiteSchemaRow;
    const columns = this.connection.prepare(
      `PRAGMA table_info(${quote(table)})`,
    ).all() as unknown as SQLiteColumnRow[];
    const indexes = this.connection.prepare(
      `PRAGMA index_list(${quote(table)})`,
    ).all() as unknown as SQLiteIndexRow[];

    return {
      table: summary,
      createSql: schema.sql,
      columns: columns.map((column) => ({
        position: column.cid,
        name: column.name,
        type: column.type,
        nullable: !column.notnull,
        defaultValue: column.dflt_value,
        primaryKeyPosition: column.pk,
      })),
      indexes: indexes.map((index) => ({
        name: index.name,
        unique: Boolean(index.unique),
        origin: index.origin,
        partial: Boolean(index.partial),
        columns: (this.connection.prepare(
          `PRAGMA index_info(${quote(index.name)})`,
        ).all() as unknown as SQLiteIndexColumnRow[])
          .map((column) => column.name)
          .filter((name): name is string => name !== null),
      })),
    };
  }

  async browseTable(
    table: string,
    options: { offset?: number; limit?: number } = {},
  ): Promise<SQLitePage> {
    const summary = await this.requireTable(table);
    const limit = clampInteger(options.limit ?? 50, 1, 250);
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const statement = this.connection.prepare(
      `SELECT * FROM ${quote(table)} LIMIT ? OFFSET ?`,
    );
    const rows = statement.all(limit, offset) as unknown as Record<string, unknown>[];
    return {
      table,
      columns: statement.columns().map((column) => column.name),
      rows,
      offset,
      limit,
      total: summary.rowCount,
    };
  }

  async execute(
    sql: string,
    options: SQLiteExecuteOptions = {},
  ): Promise<SQLiteQueryResult> {
    const normalized = stripLeadingComments(sql).trim();
    if (!normalized) throw new Error("Enter a SQL statement to run.");
    const readOnly = isReadOnlyStatement(normalized);
    if (!readOnly && !options.allowWrite) {
      throw new Error("This statement can change the database. Confirm write access before running it.");
    }

    const startedAt = performance.now();
    const statement = this.connection.prepare(normalized);
    if (readOnly) {
      const maxRows = clampInteger(options.maxRows ?? 250, 1, 1_000);
      const rows = statement.all() as unknown as Record<string, unknown>[];
      return {
        kind: "rows",
        columns: statement.columns().map((column) => column.name),
        rows: rows.slice(0, maxRows),
        changes: 0,
        durationMs: performance.now() - startedAt,
      };
    }

    const result = statement.run();
    return changeResult(result, performance.now() - startedAt);
  }

  private async requireTable(table: string): Promise<SQLiteTableSummary> {
    const found = (await this.listTables()).find((candidate) => candidate.name === table);
    if (!found) throw new Error(`Unknown SQLite table: ${table}`);
    return found;
  }
}

function changeResult(
  result: StatementResultingChanges,
  durationMs: number,
): SQLiteQueryResult {
  return {
    kind: "changes",
    columns: [],
    rows: [],
    changes: Number(result.changes),
    lastInsertRowid: typeof result.lastInsertRowid === "bigint"
      ? result.lastInsertRowid.toString()
      : result.lastInsertRowid,
    durationMs,
  };
}

function stripLeadingComments(sql: string): string {
  return sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
}

function isReadOnlyStatement(sql: string): boolean {
  const keyword = /^[A-Za-z]+/.exec(sql)?.[0]?.toUpperCase();
  return keyword === "SELECT" || keyword === "PRAGMA" || keyword === "EXPLAIN";
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
