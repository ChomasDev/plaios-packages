import type {
  DatabaseRecord,
  DatabaseStructure,
  DatabaseTableSchema,
} from "@agent-os/core";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function safeIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function normalizeNamespace(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_]+/g, "_");
  return safeIdentifier(normalized, "database namespace");
}

export function validateStructure(structure: DatabaseStructure): void {
  for (const [table, schema] of Object.entries(structure.tables)) {
    safeIdentifier(table, "table name");
    const primaryKey = schema.primaryKey ?? "id";
    if (!schema.columns[primaryKey]) {
      throw new Error(`Table ${table} must define primary key column ${primaryKey}`);
    }
    for (const column of Object.keys(schema.columns)) {
      safeIdentifier(column, "column name");
    }
    for (const index of schema.indexes ?? []) {
      for (const column of index.columns) {
        if (!schema.columns[column]) throw new Error(`Unknown index column ${column}`);
      }
    }
  }
}

export function applyDefaults(
  schema: DatabaseTableSchema,
  value: DatabaseRecord,
): DatabaseRecord {
  const result = { ...value };
  for (const [column, definition] of Object.entries(schema.columns)) {
    if (result[column] === undefined && definition.default !== undefined) {
      result[column] = structuredClone(definition.default);
    }
    if (
      definition.required &&
      (result[column] === undefined || result[column] === null)
    ) {
      throw new Error(`Missing required database field: ${column}`);
    }
  }
  for (const column of Object.keys(result)) {
    if (!schema.columns[column]) throw new Error(`Unknown database field: ${column}`);
  }
  return result;
}

export function sqliteType(type: string): string {
  if (type === "number") return "REAL";
  if (type === "boolean") return "INTEGER";
  return "TEXT";
}
