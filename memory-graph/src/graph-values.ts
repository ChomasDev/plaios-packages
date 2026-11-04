import { createHash } from "node:crypto";
import type { MemoryEntry } from "@plaios/core/domain";
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
// The lexical channel also credits a name prefix ("vale" -> "valentina") at half
// weight and is normalized by length, so long texts do not match every query.
export function hybridLexicalScores(
  query: string,
  value: string,
  tags = "",
): { exact: number; lexical: number } {
  return lexicalScores(searchTerms(query), normalizedTokens(value), undefined, normalizedTokens(tags));
}

/**
 * `weights` (term -> IDF) lets rare words such as a name count more than
 * common ones such as "sera"; without it every term weighs the same.
 * `tagTokens` are words found only in metadata (story arc, entity tags): they
 * count half, so a short fact naming a person beats a long story merely tagged
 * with that person.
 */
export function lexicalScores(
  terms: readonly string[],
  tokens: readonly string[],
  weights?: ReadonlyMap<string, number>,
  tagTokens: readonly string[] = [],
): { exact: number; lexical: number } {
  if (terms.length === 0) return { exact: 0, lexical: 0 };

  const searchable = new Set(tokens);
  const tags = new Set(tagTokens);
  const weightOf = (term: string) => weights?.get(term) ?? 1;
  const creditOf = (term: string) =>
    termCredit(term, searchable, tokens) || TAG_CREDIT * termCredit(term, tags, tagTokens);
  const total = terms.reduce((sum, term) => sum + weightOf(term), 0);
  const credit = terms.reduce((sum, term) => sum + weightOf(term) * creditOf(term), 0);
  const lexical = (credit / total) * lengthNormalization(tokens.length);

  if (terms.length === 1) {
    return { exact: searchable.has(terms[0]!) ? 1 : tags.has(terms[0]!) ? TAG_CREDIT : 0, lexical };
  }
  let exact = 0;
  for (let index = 0; index <= tokens.length - terms.length; index += 1) {
    if (!terms.every((term, offset) => tokens[index + offset] === term)) continue;
    exact = 1;
    break;
  }

  return { exact, lexical };
}

const TAG_CREDIT = 0.5;

/** Inverse document frequency of each term over the candidate token sets. */
export function termWeights(
  terms: readonly string[],
  tokenSets: readonly ReadonlySet<string>[],
): Map<string, number> {
  const count = Math.max(1, tokenSets.length);
  const vocabulary = new Set<string>();
  for (const tokens of tokenSets) for (const token of tokens) vocabulary.add(token);
  return new Map(terms.map((term) => {
    const forms = [
      term,
      ...(term.length < PREFIX_MIN_LENGTH
        ? []
        : [...vocabulary].filter((token) => token.length > term.length && token.startsWith(term))),
    ];
    const frequency = tokenSets.filter((tokens) => forms.some((form) => tokens.has(form))).length;
    return [term, Math.log(1 + count / (1 + frequency))];
  }));
}

const PREFIX_MIN_LENGTH = 4;
const PREFIX_CREDIT = 0.5;
const LENGTH_PIVOT_TOKENS = 150;

function termCredit(term: string, searchable: ReadonlySet<string>, tokens: Iterable<string>): number {
  if (searchable.has(term)) return 1;
  if (term.length < PREFIX_MIN_LENGTH) return 0;
  for (const token of tokens) {
    if (token.length > term.length && token.startsWith(term)) return PREFIX_CREDIT;
  }
  return 0;
}

function lengthNormalization(tokenCount: number): number {
  if (tokenCount <= LENGTH_PIVOT_TOKENS) return 1;
  return 1 / (1 + 0.5 * Math.log2(tokenCount / LENGTH_PIVOT_TOKENS));
}

export function searchTerms(value: string): string[] {
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

// Apostrophes split Italian elisions: "dell'Einaudi" -> "dell", "einaudi".
export function normalizedTokens(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
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
  // Italian articulated prepositions, possessives and request verbs.
  "agli", "ai", "allo", "col", "coi", "degli", "dello", "negli", "nelle",
  "nello", "sugli", "sui", "sul", "sulla", "sulle", "sullo", "mio", "mia",
  "miei", "mie", "tuo", "tua", "tuoi", "tue", "suo", "sua", "suoi", "sue",
  "dirmi", "dimmi", "riesci", "sapere", "raccontami", "parlami", "ricordi",
  "fin", "ora", "adesso", "qualcosa", "tutto", "quando", "quanto", "quanti",
  "quante", "quale", "quali", "avuto", "avere", "essere", "stato", "stata",
  "era", "ero", "mi", "ti", "ci", "si", "me", "te", "nato", "nata", "andata",
  "andato", "successo", "fatto", "abbiamo", "sapevi", "detto", "com", "cos",
  "dov", "dell", "nell", "sull", "all", "dall", "quell",
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
