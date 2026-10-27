import { createHash } from "node:crypto";
import type { MemoryEntry } from "@agent-os/core/domain";
import type { EdgeType, NodeType } from "./types.js";

export function entityId(
  type: NodeType,
  label: string,
  userId?: string,
): string {
  return hashedId("entity", `${userId ?? "global"}\0${type}\0${normalize(label)}`);
}

export function edgeId(
  sourceId: string,
  type: EdgeType,
  targetId: string,
): string {
  return hashedId("edge", `${sourceId}\0${type}\0${targetId}`);
}

export function searchableText(
  type: NodeType,
  label: string,
  data: unknown,
  metadata?: Readonly<Record<string, unknown>>,
): string {
  return `${type} ${label} ${safeJson(data)} ${safeJson(metadata ?? {})}`;
}

export function labelFor(content: unknown): string {
  const value = typeof content === "string" ? content : safeJson(content);
  return value.slice(0, 160);
}

export function cloneEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
    addedMemoryDate: entry.addedMemoryDate
      ? new Date(entry.addedMemoryDate)
      : undefined,
    factDate: entry.factDate ? new Date(entry.factDate) : undefined,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : undefined,
    metadata: { ...entry.metadata },
  };
}

export function cosine(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

// Exact channel rewards a contiguous run of meaningful terms (filler stripped),
// so a single entity name such as "Alessia" still counts as an exact hit.
export function hybridLexicalScores(
  query: string,
  value: string,
): { exact: number; lexical: number } {
  const terms = searchTerms(query);
  if (terms.length === 0) return { exact: 0, lexical: 0 };

  const tokens = normalizedTokens(value);
  const searchable = new Set(tokens);
  const matches = terms.filter((term) => searchable.has(term));
  const lexical = matches.length / terms.length;
  let exact = 0;

  if (terms.length === 1) {
    exact = searchable.has(terms[0]!) ? 1 : 0;
  } else {
    for (let index = 0; index <= tokens.length - terms.length; index += 1) {
      if (!terms.every((term, offset) => tokens[index + offset] === term)) continue;
      exact = 1;
      break;
    }
  }

  return { exact, lexical };
}

function searchTerms(value: string): string[] {
  const tokens = normalizedTokens(value).filter((token) =>
    (token.length >= 3 || SHORT_SEARCH_TERMS.has(token)) &&
    !SEARCH_STOPWORDS.has(token)
  );
  return [...new Set(tokens)].slice(0, 12);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedTokens(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_'-]+/gu) ?? [];
}

const SHORT_SEARCH_TERMS = new Set(["ai", "ia"]);

// Kept deliberately small and deterministic. These are transport/prompt words
// and common Italian/English question words, not domain vocabulary.
const SEARCH_STOPWORDS = new Set([
  "a", "about", "al", "alla", "alle", "an", "and", "are", "as",
  "at", "be", "by", "can", "che", "chi", "come", "con", "conversation",
  "cosa", "da", "dal", "dalla", "dei", "del", "della", "delle", "di",
  "do", "does", "dove", "e", "for", "fra", "from", "gli", "ha", "hai",
  "hanno", "have", "ho", "how", "i", "il", "in", "is", "it", "la",
  "le", "lo", "ma", "nel", "nella", "nei", "no", "non", "of", "on",
  "openrouter", "or", "per", "perche", "perché", "posso", "puoi", "sai",
  "sei", "sono", "su", "supplied", "the", "through", "to", "tra", "un",
  "una", "uno", "user", "was", "what", "when", "where", "which", "who",
  "why", "with", "would",
]);

function hashedId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
