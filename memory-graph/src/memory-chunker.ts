import type { MemoryEntry } from "@plaios/core/domain";

export const CHUNK_THRESHOLD_CHARS = 1_200;
export const CHUNK_TARGET_CHARS = 700;

/** Chat history stays whole: it is the transcript, not a recall unit. */
export function shouldChunk(entry: MemoryEntry, threshold = CHUNK_THRESHOLD_CHARS): boolean {
  return entry.kind !== "working"
    && typeof entry.content === "string"
    && entry.content.length > threshold
    && entry.metadata?.chunkOf === undefined;
}

/**
 * Splits a long story into scene-sized pieces: paragraphs first, then sentences,
 * so every chunk reads on its own. Nothing is dropped: joining the chunks gives
 * back every sentence of the original.
 */
export function splitIntoChunks(text: string, target = CHUNK_TARGET_CHARS): string[] {
  const units = text
    .split(/\n\s*\n|\n(?=\S)/)
    .flatMap((paragraph) => splitLongUnit(paragraph.trim(), target))
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    // A short piece (a one-line paragraph) joins the next one instead of standing alone.
    if (current.length >= target / 3 && current.length + unit.length + 1 > target) {
      chunks.push(current);
      current = unit;
      continue;
    }
    current = current ? `${current} ${unit}` : unit;
  }
  if (current) chunks.push(current);
  return mergeShortTail(chunks, target);
}

/** A chunk id is stable, so re-saving or re-migrating the same memory is idempotent. */
export function chunkId(parentId: string, index: number): string {
  return `${parentId}#chunk-${index + 1}`;
}

export function chunkTitle(title: unknown, index: number, count: number): string {
  const base = typeof title === "string" && title.trim() ? title.trim() : "Ricordo";
  return `${base} (parte ${index + 1}/${count})`;
}

/** People (or other entity labels) named in a chunk, matched as whole words. */
export function peopleIn(text: string, labels: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return [...new Set(labels)].filter((label) => {
    const first = label.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 3) return false;
    return new RegExp(`(^|[^\\p{L}])${escapeRegExp(first)}([^\\p{L}]|$)`, "u").test(lower);
  });
}

function splitLongUnit(unit: string, target: number): string[] {
  if (unit.length <= target) return [unit];
  const sentences = unit
    .match(/[^.!?…]+(?:[.!?…]+["”»)]*|$)\s*/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [unit];
  return sentences.flatMap((sentence) =>
    sentence.length <= target * 1.5 ? [sentence] : splitAtCommas(sentence, target));
}

function splitAtCommas(sentence: string, target: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const piece of sentence.split(/(?<=,)\s+/)) {
    if (current && current.length + piece.length + 1 > target) {
      parts.push(current);
      current = piece;
      continue;
    }
    current = current ? `${current} ${piece}` : piece;
  }
  if (current) parts.push(current);
  return parts;
}

function mergeShortTail(chunks: string[], target: number): string[] {
  if (chunks.length < 2) return chunks;
  const last = chunks.at(-1)!;
  if (last.length >= target / 3) return chunks;
  return [...chunks.slice(0, -2), `${chunks.at(-2)} ${last}`];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
