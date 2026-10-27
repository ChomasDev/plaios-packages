/** The fields a free-text device query is matched against. */
export interface QueryableEntity { entityId: string; name: string; area?: string }

/**
 * Every word of the query must appear in the name, area or entity id; if no entity matches every word,
 * any word will do, so "garage cameras" still finds the garage cameras.
 */
export function filterByQuery<T extends QueryableEntity>(entities: readonly T[], query?: string | null): T[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entities];
  const haystack = (entity: T) => `${entity.name} ${entity.area ?? ""} ${entity.entityId.replace(/[._]/g, " ")}`.toLowerCase();
  const all = entities.filter((entity) => words.every((word) => haystack(entity).includes(word)));
  if (all.length) return all;
  return entities.filter((entity) => words.some((word) => haystack(entity).includes(word)));
}
