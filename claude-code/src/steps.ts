import type { AIExecutableFunctionDefinition, AIFunctionDefinition, JsonSchema } from "@plaios/core";

// shortcut: same step protocol as @plaios/codex, copied rather than shared; move both into @plaios/systems when a third provider needs it.

export interface FunctionStep { type: "text" | "function-call"; name: string; arguments: unknown; text: string | null; finishOnSuccess: boolean }

export function createFunctionInstructions(definitions: readonly AIExecutableFunctionDefinition[]): string {
  return [
    "Choose whether to call one PLAIOS capability or return the final answer.",
    "For a function call, set type to function-call and provide its exact name and arguments.",
    "Set finishOnSuccess to true only for one unambiguous state-changing command when no result data, follow-up capability, delay, or additional action is needed. In that case, write a short natural confirmation in the user's language in text; it will be sent only after the capability reports success.",
    "For reads, questions, uncertain targets, delayed, visual, or multi-step requests, set finishOnSuccess to false and text to null so you can inspect the capability result, including any screenshot.",
    "If a capability returns a screenshot or localPath image, look at that image before describing what you see.",
    "For a final answer, set type to text, name to an empty string, arguments to null, finishOnSuccess to false, and provide text.",
    "Available PLAIOS capabilities:",
    serialize(definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))),
  ].join("\n");
}

export function createFunctionStepSchema(definitions: readonly AIExecutableFunctionDefinition[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      type: { type: "string", enum: ["text", "function-call"] },
      name: { type: "string", enum: ["", ...definitions.map(({ name }) => name)] },
      arguments: { anyOf: [{ type: "null" }, ...definitions.map(({ inputSchema }) => normalizeOutputSchema(inputSchema))] },
      text: { type: ["string", "null"] },
      finishOnSuccess: { type: "boolean" },
    },
    required: ["type", "name", "arguments", "text", "finishOnSuccess"],
    additionalProperties: false,
  };
}

/** Strict structured output: every property required, optional ones nullable, no extra keys. */
export function normalizeOutputSchema(schema: JsonSchema): JsonSchema { return normalizeSchemaNode(schema) as JsonSchema; }
function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchemaNode);
  if (!isRecord(value)) return value;
  const normalized = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeSchemaNode(entry)]));
  if (!isRecord(value.properties)) return normalized;
  const originallyRequired = new Set(Array.isArray(value.required) ? value.required.filter((entry): entry is string => typeof entry === "string") : []);
  const properties = Object.fromEntries(Object.entries(value.properties).map(([key, propertySchema]) => {
    const property = normalizeSchemaNode(propertySchema);
    return [key, originallyRequired.has(key) || allowsNull(property) ? property : { anyOf: [property, { type: "null" }] }];
  }));
  return { ...normalized, properties, required: Object.keys(properties), additionalProperties: false };
}
function allowsNull(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === "null") return true;
  if (Array.isArray(value.type) && value.type.includes("null")) return true;
  if (Array.isArray(value.enum) && value.enum.includes(null)) return true;
  return ["anyOf", "oneOf"].some((key) => Array.isArray(value[key]) && value[key].some(allowsNull));
}

export function parseFunctionStep(value: unknown): FunctionStep {
  const parsed = typeof value === "string" ? parseJson<Record<string, unknown>>(value, "function step") : value;
  if (!isRecord(parsed) || (parsed.type !== "text" && parsed.type !== "function-call") || typeof parsed.name !== "string" || (parsed.text !== null && typeof parsed.text !== "string") || typeof parsed.finishOnSuccess !== "boolean") {
    throw new Error("Claude Code returned an invalid function step");
  }
  return { type: parsed.type, name: parsed.name, arguments: parsed.arguments, text: parsed.text, finishOnSuccess: parsed.finishOnSuccess };
}

export function shouldFinishAfterCapability(step: Pick<FunctionStep, "type" | "text" | "finishOnSuccess">, output: unknown): boolean {
  return step.type === "function-call" && step.finishOnSuccess && typeof step.text === "string" && step.text.trim().length > 0 && isRecord(output) && output.success === true;
}

export function createCapabilityFollowUp(name: string, output: unknown): string {
  return [
    `PLAIOS executed "${name}".`,
    "",
    "Capability result:",
    serialize(output),
    "",
    "Continue the original request. If the result includes a screenshot or localPath image, look at the image before answering.",
    "Call another capability if another step is still needed, otherwise return the final answer.",
  ].join("\n");
}

/** A screenshot a capability saved (`data.localPath`), so the follow-up can show it to the model. */
export function imageFromCapabilityOutput(output: unknown): string | undefined {
  if (!isRecord(output) || !isRecord(output.data)) return undefined;
  const path = typeof output.data.localPath === "string" ? output.data.localPath.trim() : "";
  return path && /\.(png|jpe?g|webp|gif)$/i.test(path) ? path : undefined;
}

export function validateDefinitions(definitions: readonly AIFunctionDefinition[]): void {
  const names = new Set<string>();
  for (const definition of definitions) {
    validateDefinition(definition);
    if (names.has(definition.name)) throw new Error(`Duplicate AI function name: "${definition.name}"`);
    names.add(definition.name);
  }
}
export function validateDefinition(definition: AIFunctionDefinition): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) throw new Error(`Invalid AI function name: "${definition.name}"`);
}

/** Decodes the `text` of an incomplete `{"type":"text", ...}` step so it can stream; undefined until the step is known to be text. */
export function partialFinalText(json: string): string | undefined {
  if (!/^\s*\{\s*"type"\s*:\s*"text"/.test(json)) return undefined;
  const match = /"text"\s*:\s*"/.exec(json);
  if (!match) return "";
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };
  let out = "";
  for (let index = match.index + match[0].length; index < json.length; index += 1) {
    const char = json[index]!;
    if (char === '"') return out;
    if (char !== "\\") { out += char; continue; }
    const next = json[index + 1];
    if (next === undefined) return out;
    if (next === "u") { const hex = json.slice(index + 2, index + 6); if (hex.length < 4) return out; out += String.fromCharCode(parseInt(hex, 16)); index += 5; continue; }
    out += escapes[next] ?? next;
    index += 1;
  }
  return out;
}

export function parseJson<T>(value: string, label: string): T {
  try { return JSON.parse(value) as T; } catch (error) { throw new Error(`Claude Code returned invalid JSON for ${label}`, { cause: error }); }
}
export function serialize(value: unknown): string { try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); } }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
