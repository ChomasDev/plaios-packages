import type {
  DatabaseColumnSchema,
  DatabaseColumnType,
  DatabaseStructure,
} from "@plaios/core/domain";
import { TABLES } from "./internal-types.js";

export function createGraphSchema(): DatabaseStructure {
  return {
    tables: {
      [TABLES.nodes]: {
        primaryKey: "id",
        columns: {
          id: required("string"),
          type: required("string"),
          label: required("string"),
          data: required("json"),
          entry: { type: "json" },
          metadata: required("json", {}),
          embedding: required("json", []),
          userId: { type: "string" },
          sessionId: { type: "string" },
          kind: { type: "string" },
          weight: required("number", 1),
          accessCount: required("number", 0),
          createdAt: required("datetime"),
          updatedAt: required("datetime"),
          lastAccessedAt: { type: "datetime" },
          weightUpdatedAt: required("datetime"),
        },
        indexes: [
          { columns: ["type", "userId"] },
          { columns: ["sessionId", "createdAt"] },
        ],
      },
      [TABLES.details]: {
        primaryKey: "id",
        columns: {
          id: required("string"),
          nodeId: required("string"),
          type: required("string"),
          data: required("json", {}),
          updatedAt: required("datetime"),
        },
        indexes: [{ columns: ["nodeId", "type"], unique: true }],
      },
      [TABLES.edges]: {
        primaryKey: "id",
        columns: {
          id: required("string"),
          sourceId: required("string"),
          targetId: required("string"),
          type: required("string"),
          weight: required("number", 1),
          metadata: required("json", {}),
          createdAt: required("datetime"),
          updatedAt: required("datetime"),
        },
        indexes: [
          { columns: ["sourceId"] },
          { columns: ["targetId"] },
        ],
      },
    },
  };
}

function required(
  type: DatabaseColumnType,
  defaultValue?: unknown,
): DatabaseColumnSchema {
  return {
    type,
    required: true,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}
