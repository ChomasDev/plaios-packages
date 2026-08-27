import type { EmbeddingProvider } from "./types.js";

/** Dependency-free fallback. Replace it with a model-backed provider in production. */
export class HashEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 256) {
    if (!Number.isInteger(dimensions) || dimensions < 8) {
      throw new Error("HashEmbeddingProvider dimensions must be an integer >= 8");
    }
  }

  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = Array<number>(this.dimensions).fill(0);
    const tokens = normalize(text).match(/[\p{L}\p{N}_'-]+/gu) ?? [];
    for (const token of tokens) {
      const hash = fnv1a(token);
      vector[hash % this.dimensions]! += (hash & 1) === 0 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
