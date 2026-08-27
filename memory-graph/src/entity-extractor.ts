import type { MemoryEntry } from "@agent-os/core/domain";
import {
  MemoryEdgeType,
  MemoryNodeType,
  type EntityExtractor,
  type EntityMention,
  type NodeType,
} from "./types.js";

const ENTITY_KEYS: Readonly<Record<string, NodeType>> = {
  person: MemoryNodeType.Person,
  people: MemoryNodeType.Person,
  persons: MemoryNodeType.Person,
  hobby: MemoryNodeType.Hobby,
  hobbies: MemoryNodeType.Hobby,
  place: MemoryNodeType.Place,
  places: MemoryNodeType.Place,
  organization: MemoryNodeType.Organization,
  organizations: MemoryNodeType.Organization,
  topic: MemoryNodeType.Topic,
  topics: MemoryNodeType.Topic,
  skill: MemoryNodeType.Skill,
  skills: MemoryNodeType.Skill,
  project: MemoryNodeType.Project,
  projects: MemoryNodeType.Project,
};

/**
 * Extracts explicit metadata entities, structured object fields, and a small
 * set of conservative English person patterns. Inject an AI extractor for
 * unrestricted natural-language entity recognition.
 */
export class DefaultEntityExtractor implements EntityExtractor {
  async extract(entry: MemoryEntry): Promise<readonly EntityMention[]> {
    const mentions: EntityMention[] = [];
    readExplicitEntities(entry.metadata?.entities, mentions);
    readObject(entry.content, mentions);
    if (typeof entry.content === "string") readText(entry.content, mentions);
    return deduplicate(mentions);
  }
}

function readExplicitEntities(value: unknown, output: EntityMention[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      output.push({ type: MemoryNodeType.Topic, name: item });
      continue;
    }
    if (!isRecord(item) || typeof item.type !== "string" || typeof item.name !== "string") continue;
    output.push({
      type: item.type,
      name: item.name,
      data: isRecord(item.data) ? item.data : undefined,
      relation: typeof item.relation === "string" ? item.relation : undefined,
      relatedTo: typeof item.relatedTo === "string" ? item.relatedTo : undefined,
    });
  }
}

function readObject(value: unknown, output: EntityMention[]): void {
  if (!isRecord(value)) return;
  for (const [key, raw] of Object.entries(value)) {
    const type = ENTITY_KEYS[key.toLowerCase()];
    if (!type) continue;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (typeof item === "string") output.push({ type, name: item });
      else if (isRecord(item)) readStructuredEntity(type, item, output);
    }
  }
}

function readStructuredEntity(type: NodeType, item: Record<string, unknown>, output: EntityMention[]): void {
  const name = stringValue(item.name ?? item.label ?? item.title);
  if (!name) return;
  const data = Object.fromEntries(Object.entries(item).filter(([key]) => !["name", "label", "title", "hobbies"].includes(key)));
  output.push({ type, name, data });
  if (type === MemoryNodeType.Person && Array.isArray(item.hobbies)) {
    for (const hobby of item.hobbies) {
      if (typeof hobby === "string") {
        output.push({
          type: MemoryNodeType.Hobby,
          name: hobby,
          relation: MemoryEdgeType.HasHobby,
          relatedTo: `${MemoryNodeType.Person}:${name}`,
        });
      }
    }
  }
}

function readText(text: string, output: EntityMention[]): void {
  const personPattern = /\b(?:met|meet|meeting|mentioned|called|named|spoke (?:with|to)|talked (?:with|to))\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,2})/gu;
  for (const match of text.matchAll(personPattern)) {
    output.push({ type: MemoryNodeType.Person, name: match[1]! });
  }
}

function deduplicate(mentions: readonly EntityMention[]): EntityMention[] {
  const unique = new Map<string, EntityMention>();
  for (const mention of mentions) {
    const name = mention.name.trim();
    if (!name) continue;
    const key = `${mention.type}:${name.toLowerCase()}:${mention.relatedTo ?? ""}:${mention.relation ?? ""}`;
    const current = unique.get(key);
    unique.set(key, current ? { ...current, data: { ...current.data, ...mention.data } } : { ...mention, name });
  }
  return [...unique.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
