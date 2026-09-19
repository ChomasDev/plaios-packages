export interface ProtocolDefinition {
  trigger: string;
  instruction: string;
  expansion: string;
  url?: string;
  device?: string;
}

export interface ProtocolMemory {
  remember?(entry: {
    id: string;
    kind: "procedural";
    content: string;
    createdAt: Date;
    userId?: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  recall?(query: {
    text?: string;
    kinds?: readonly string[];
    userId?: string;
    limit?: number;
    metadata?: Record<string, unknown>;
  }): Promise<readonly { content?: unknown; metadata?: Readonly<Record<string, unknown>> }[]>;
  upsertNode?(node: {
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
    userId?: string;
    kind: "procedural";
    metadata: Record<string, unknown>;
  }): Promise<unknown>;
  listNodes?(query?: { type?: string; userId?: string }): Promise<readonly {
    type: string;
    label: string;
    data?: unknown;
    metadata?: Readonly<Record<string, unknown>>;
    userId?: string;
  }[]>;
}

export function parseProtocolRemember(text: string): ProtocolDefinition | undefined {
  const trimmed = text.trim();
  const quoted = trimmed.match(
    /(?:ricorda(?:\s+che)?|remember(?:\s+that)?)\s+(?:quando\s+(?:ti\s+)?dico|when\s+i\s+say)\s+["“«](.+?)["”»]\s+(?:devi(?:\s+fare)?|fai|do|you\s+(?:should|must)|to)\s+(.+)/is,
  );
  if (quoted?.[1] && quoted[2]) return defineProtocol(quoted[1], quoted[2]);
  const unquoted = trimmed.match(
    /(?:ricorda(?:\s+che)?|remember(?:\s+that)?)\s+(?:quando\s+(?:ti\s+)?dico|when\s+i\s+say)\s+(.+?)\s+(?:devi(?:\s+fare)?|fai|do|you\s+(?:should|must))\s+(.+)/is,
  );
  if (unquoted?.[1] && unquoted[2]) return defineProtocol(unquoted[1], unquoted[2]);
  return undefined;
}

export function defineProtocol(trigger: string, instruction: string): ProtocolDefinition {
  const cleanTrigger = stripQuotes(trigger);
  const cleanInstruction = instruction.trim().replace(/[.]+\s*$/, "");
  const url = extractUrl(cleanInstruction);
  const device = /\b(mac|macos|pc|computer)\b/i.test(cleanInstruction) ? "mac" : undefined;
  return {
    trigger: cleanTrigger,
    instruction: cleanInstruction,
    expansion: expandProtocolInstruction(cleanInstruction),
    ...(url ? { url } : {}),
    ...(device ? { device } : {}),
  };
}

export function expandProtocolInstruction(instruction: string): string {
  const url = extractUrl(instruction);
  if (!url) return instruction.trim();
  const onMac = /\b(mac|macos|pc|computer)\b/i.test(instruction);
  return onMac ? `Apri ${url} sul Mac` : `Apri ${url}`;
}

export function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match?.[0]?.replace(/[),.;]+$/, "");
}

export function matchProtocolTrigger(utterance: string, trigger: string): boolean {
  const spoken = normalizePhrase(utterance);
  const expected = normalizePhrase(trigger);
  if (!spoken || !expected) return false;
  if (spoken === expected || spoken.includes(expected) || expected.includes(spoken)) return true;
  const spokenTokens = spoken.split(" ");
  const expectedTokens = expected.split(" ");
  if (expectedTokens.length === 0 || spokenTokens.length > expectedTokens.length + 4) return false;
  return expectedTokens.every((token) =>
    spokenTokens.some((candidate) => candidate === token || levenshtein(candidate, token) <= 2));
}

export function protocolConfirmation(protocol: ProtocolDefinition): string {
  return protocol.url
    ? `Ok, quando dici "${protocol.trigger}" apro ${protocol.url}${protocol.device === "mac" ? " sul Mac" : ""}.`
    : `Ok, quando dici "${protocol.trigger}" eseguo: ${protocol.expansion}.`;
}

export async function saveProtocol(
  memory: ProtocolMemory | undefined,
  userId: string | undefined,
  protocol: ProtocolDefinition,
): Promise<void> {
  if (!memory) return;
  const metadata = {
    namespace: "protocol",
    trigger: protocol.trigger,
    expansion: protocol.expansion,
    instruction: protocol.instruction,
    ...(protocol.url ? { url: protocol.url } : {}),
    ...(protocol.device ? { device: protocol.device } : {}),
  };
  if (typeof memory.upsertNode === "function") {
    await memory.upsertNode({
      id: "",
      type: "protocol",
      label: protocol.trigger,
      data: { ...metadata },
      ...(userId ? { userId } : {}),
      kind: "procedural",
      metadata,
    });
  }
  if (typeof memory.remember === "function") {
    await memory.remember({
      id: `protocol:${slug(protocol.trigger)}`,
      kind: "procedural",
      content: `When the user says "${protocol.trigger}", ${protocol.expansion}`,
      createdAt: new Date(),
      ...(userId ? { userId } : {}),
      metadata,
    });
  }
}

export async function findMatchingProtocol(
  memory: ProtocolMemory | undefined,
  userId: string | undefined,
  utterance: string,
): Promise<ProtocolDefinition | undefined> {
  if (!memory) return undefined;
  const protocols = await loadProtocols(memory, userId, utterance);
  return protocols.find((protocol) => matchProtocolTrigger(utterance, protocol.trigger));
}

export function remoteComputerCapabilityId(
  candidates: readonly { id: string; tags?: readonly string[] }[],
): string | undefined {
  return candidates.find((item) => item.id === "ssh.jev")?.id
    ?? candidates.find((item) => item.tags?.includes("direct") && item.tags.includes("ssh"))?.id
    ?? candidates.find((item) => item.id.startsWith("ssh."))?.id;
}

async function loadProtocols(
  memory: ProtocolMemory,
  userId: string | undefined,
  utterance: string,
): Promise<ProtocolDefinition[]> {
  const found: ProtocolDefinition[] = [];
  if (typeof memory.listNodes === "function") {
    const nodes = await memory.listNodes({ type: "protocol", ...(userId ? { userId } : {}) });
    for (const node of nodes) pushProtocol(found, fromNode(node));
  }
  if (found.length === 0 && typeof memory.recall === "function") {
    const entries = await memory.recall({
      text: utterance,
      kinds: ["procedural"],
      ...(userId ? { userId } : {}),
      limit: 20,
      metadata: { namespace: "protocol" },
    });
    for (const entry of entries) pushProtocol(found, fromEntry(entry));
  }
  return found;
}

function fromNode(node: {
  label: string;
  data?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
}): ProtocolDefinition | undefined {
  const data = isRecord(node.data) ? node.data : {};
  const trigger = stringValue(data.trigger) ?? stringValue(node.metadata?.trigger) ?? node.label;
  const instruction = stringValue(data.instruction)
    ?? stringValue(data.expansion)
    ?? stringValue(node.metadata?.expansion)
    ?? trigger;
  if (!trigger) return undefined;
  return defineProtocol(trigger, instruction);
}

function fromEntry(entry: {
  content?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
}): ProtocolDefinition | undefined {
  const metadata = entry.metadata ?? {};
  if (metadata.namespace !== "protocol" && metadata.graphNodeType !== "protocol") return undefined;
  const content = isRecord(entry.content) ? entry.content : {};
  const trigger = stringValue(metadata.trigger)
    ?? stringValue(content.trigger)
    ?? stringValue(content.label);
  const instruction = stringValue(metadata.expansion)
    ?? stringValue(content.expansion)
    ?? stringValue(content.instruction)
    ?? (typeof entry.content === "string" ? entry.content : undefined);
  if (!trigger || !instruction) return undefined;
  return defineProtocol(trigger, instruction);
}

function pushProtocol(output: ProtocolDefinition[], protocol?: ProtocolDefinition): void {
  if (!protocol) return;
  if (output.some((item) => normalizePhrase(item.trigger) === normalizePhrase(protocol.trigger))) return;
  output.push(protocol);
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["“«]+|["”»]+$/g, "").trim();
}

function slug(value: string): string {
  return normalizePhrase(value).replace(/\s+/g, "-") || "unnamed";
}

export function normalizePhrase(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid = Array.from({ length: rows }, (_, row) => {
    const line = new Array<number>(cols);
    line[0] = row;
    return line;
  });
  for (let col = 0; col < cols; col += 1) grid[0]![col] = col;
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      grid[row]![col] = Math.min(
        grid[row - 1]![col]! + 1,
        grid[row]![col - 1]! + 1,
        grid[row - 1]![col - 1]! + cost,
      );
    }
  }
  return grid[left.length]![right.length]!;
}
