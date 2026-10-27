import type { MemoryEntry } from "@plaios/core/domain";
import type { RankedNode, StoredNode } from "./internal-types.js";
import { asRecord, cloneEntry } from "./graph-values.js";
import type { GraphNode } from "./types.js";

export function toMemoryEntry(
  item: RankedNode,
  weight: number,
): MemoryEntry {
  const graph = {
    graphNodeType: item.node.type,
    graphScore: item.score,
    graphDepth: item.depth,
    graphWeight: weight,
    graphAccessCount: item.node.accessCount,
    ...(item.relatedVia ? { graphRelatedVia: item.relatedVia } : {}),
  };

  if (item.node.entry) {
    return {
      ...cloneEntry(item.node.entry),
      importance: weight,
      metadata: { ...item.node.entry.metadata, ...graph },
    };
  }

  return {
    id: item.node.id,
    kind: item.node.kind ?? "semantic",
    content: {
      type: item.node.type,
      label: item.node.label,
      ...asRecord(item.node.data),
    },
    createdAt: item.node.createdAt,
    addedMemoryDate: item.node.createdAt,
    updatedAt: item.node.updatedAt,
    userId: item.node.userId ?? undefined,
    sessionId: item.node.sessionId ?? undefined,
    importance: weight,
    metadata: { ...item.node.metadata, ...graph },
  };
}

export function toGraphNode(node: StoredNode, weight: number): GraphNode {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    data: node.data as Readonly<Record<string, unknown>>,
    metadata: node.metadata,
    userId: node.userId ?? undefined,
    sessionId: node.sessionId ?? undefined,
    kind: node.kind ?? undefined,
    weight,
    createdAt: node.createdAt,
    addedMemoryDate: node.entry?.addedMemoryDate
      ? new Date(node.entry.addedMemoryDate)
      : node.createdAt,
    factDate: node.entry?.factDate ? new Date(node.entry.factDate) : undefined,
  };
}
