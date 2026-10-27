import type { HomeAssistantEntity } from "../../../src/index.js";
import { filterByQuery } from "../entity-query.js";
import type { EntityArgs } from "./types.js";

/** Exact ids win; otherwise the query narrows the given domains. */
export function selectEntities(entities: readonly HomeAssistantEntity[], args: EntityArgs, accept: (domain: string) => boolean): HomeAssistantEntity[] {
  const ids = args.entityIds?.map((id) => id.trim().toLowerCase()).filter(Boolean);
  if (ids?.length) return entities.filter((entity) => ids.includes(entity.entityId));
  return filterByQuery(entities.filter((entity) => accept(entity.domain)), args.query);
}

export function isActive(entity: HomeAssistantEntity): boolean {
  return !["off", "closed", "locked", "unavailable", "unknown", "idle", "standby"].includes(entity.state);
}

export function relativeTime(value?: string): string {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
