import { randomUUID } from "node:crypto";
import { Codex, type ApprovalMode, type CodexOptions, type Input as CodexInput, type ModelReasoningEffort, type SandboxMode, type WebSearchMode } from "@openai/codex-sdk";
import type { AIExecutableFunctionDefinition, AIFunctionCallResult, AIFunctionDefinition, AIFunctionProcessOptions, AIInput, AIModelSettings, AIProcessOptions, AIProcessResult, JsonSchema, System2, SystemAnswers, SystemAskOptions, SystemQuestions } from "@plaios/core";
import { askWithFunctionCall } from "@plaios/systems";
import { PersistentCodexAppServer, type PersistentThreadOptions } from "./persistent-app-server.js";

export interface CodexProviderOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  settings?: AIModelSettings;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalMode;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  codexPathOverride?: string;
  config?: CodexOptions["config"];
  persistentProcess?: boolean;
}

interface FunctionStep { type: "text" | "function-call"; name: string; arguments: unknown; text: string | null; finishOnSuccess: boolean; }

const providerInstructions = [
  "You are the model inside PLAIOS.",
  "Do not inspect or modify the workspace and do not use Codex built-in tools.",
  "Use only the request and the PLAIOS capabilities explicitly described in it.",
].join(" ");

export class CodexProvider implements System2 {
  readonly provider = "codex" as const;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;
  private readonly codex: Codex | PersistentCodexAppServer;
  private readonly threadOptions: PersistentThreadOptions;
  private readonly status: {
    credentialMode: "api-key" | "codex-session";
    workingDirectory: string;
    sandboxMode: SandboxMode;
    approvalPolicy: ApprovalMode;
    networkAccessEnabled: boolean;
    webSearchMode: WebSearchMode;
    modelReasoningEffort?: ModelReasoningEffort;
    persistentProcess: boolean;
  };

  constructor(options: CodexProviderOptions) {
    const model = options.model?.trim();
    if (!model) throw new Error("CodexProvider model is required");
    const workingDirectory = options.workingDirectory ?? process.cwd();
    const sandboxMode = options.sandboxMode ?? "read-only";
    const approvalPolicy = options.approvalPolicy ?? "never";
    const networkAccessEnabled = options.networkAccessEnabled ?? false;
    const webSearchMode = options.webSearchMode ?? "disabled";
    const persistentProcess = options.persistentProcess ?? true;
    this.model = model;
    this.settings = Object.freeze({ ...options.settings });
    this.codex = persistentProcess
      ? new PersistentCodexAppServer({ apiKey: options.apiKey, baseUrl: options.baseUrl, codexPathOverride: options.codexPathOverride, config: options.config })
      : new Codex({ apiKey: options.apiKey, baseUrl: options.baseUrl, codexPathOverride: options.codexPathOverride, config: options.config });
    this.threadOptions = { model, workingDirectory, skipGitRepoCheck: options.skipGitRepoCheck ?? true, sandboxMode, approvalPolicy, modelReasoningEffort: options.modelReasoningEffort, networkAccessEnabled, webSearchMode };
    this.status = { credentialMode: options.apiKey || process.env.CODEX_API_KEY ? "api-key" : "codex-session", workingDirectory, sandboxMode, approvalPolicy, networkAccessEnabled, webSearchMode, modelReasoningEffort: options.modelReasoningEffort, persistentProcess };
  }

  microfrontendData() {
    return { provider: this.provider, model: this.model, ...this.status };
  }

  async processInput(input: AIInput, options: AIProcessOptions = {}): Promise<AIProcessResult> {
    const prompt = createCodexInput(input, options.instructions);
    const thread = this.startThread();
    if (options.stream) return { type: "stream", stream: streamText(thread, prompt, resolveSignal(this.settings, options)) };
    const result = await thread.run(prompt, { signal: resolveSignal(this.settings, options) });
    return { type: "text", text: result.finalResponse };
  }

  ask(state: Record<string, unknown>, questions: SystemQuestions, options?: SystemAskOptions): Promise<SystemAnswers> {
    return askWithFunctionCall(this, state, questions, options);
  }

  async functionCall<TArguments>(input: string, definition: AIFunctionDefinition<TArguments>, options: Omit<AIProcessOptions, "stream"> = {}): Promise<AIFunctionCallResult<TArguments>> {
    validateDefinition(definition);
    const prompt = createPrompt(input, options.instructions, `Return the arguments for the required "${definition.name}" function.\nFunction description: ${definition.description}\nReturn only the JSON object matching the supplied output schema.`);
    const result = await this.startThread().run(prompt, { outputSchema: normalizeCodexOutputSchema(definition.inputSchema), signal: resolveSignal(this.settings, options) });
    return { type: "function-call", name: definition.name, callId: `codex-${randomUUID()}`, arguments: parseJson<TArguments>(result.finalResponse, `function "${definition.name}" arguments`) };
  }

  async processWithFunctions(input: AIInput, definitions: readonly AIExecutableFunctionDefinition[], options: AIFunctionProcessOptions = {}): Promise<AIProcessResult> {
    if (definitions.length === 0) return this.processInput(input, options);
    validateDefinitions(definitions);
    const stream = this.runFunctionLoop(input, definitions, options);
    if (options.stream) return { type: "stream", stream };
    let text = "";
    for await (const chunk of stream) text += chunk;
    return { type: "text", text };
  }

  async close(): Promise<void> {
    if (this.codex instanceof PersistentCodexAppServer) await this.codex.close();
  }

  private startThread(): RunnableThread { return this.codex.startThread(this.threadOptions) as RunnableThread; }

  private async *runFunctionLoop(input: AIInput, definitions: readonly AIExecutableFunctionDefinition[], options: AIFunctionProcessOptions): AsyncGenerator<string> {
    const thread = this.startThread();
    const schema = createFunctionStepSchema(definitions);
    const maxSteps = Math.max(1, options.maxSteps ?? 100);
    let prompt: CodexInput = createCodexInput(input, options.instructions, createFunctionInstructions(definitions));
    for (let step = 0; step < maxSteps; step += 1) {
      // Stream the final answer's `text` field while the step JSON is still arriving; tool-call steps stay buffered.
      let finalResponse = "";
      let sent = 0;
      for await (const text of agentMessages(thread, prompt, { outputSchema: schema, signal: resolveSignal(this.settings, options) })) {
        finalResponse = text;
        const decoded = partialFinalText(text);
        if (decoded !== undefined && decoded.length > sent) { yield decoded.slice(sent); sent = decoded.length; }
      }
      const requested = parseFunctionStep(finalResponse);
      if (requested.type === "text") { if (typeof requested.text !== "string") throw new Error("Codex returned a final step without text"); const rest = requested.text.slice(sent); if (rest) yield rest; return; }
      const definition = definitions.find((candidate) => candidate.name === requested.name);
      if (!definition) throw new Error(`Codex requested unknown function "${requested.name}"`);
      const output = await definition.execute(requested.arguments, { callId: `codex-${randomUUID()}`, signal: options.signal });
      if (shouldFinishAfterCapability(requested, output)) {
        yield requested.text!;
        return;
      }
      prompt = createCapabilityFollowUp(definition.name, output);
    }
    throw new Error(`Codex exceeded the ${maxSteps}-step function-call limit`);
  }
}

function createPrompt(input: string, instructions?: string, taskInstructions?: string): string {
  const normalized = input.trim();
  if (!normalized) throw new Error("AI input is required");
  return [providerInstructions, instructions?.trim(), taskInstructions?.trim(), "Request:", normalized].filter((part): part is string => Boolean(part)).join("\n\n");
}

export function createCodexInput(input: AIInput, instructions?: string, taskInstructions?: string): CodexInput {
  const text = typeof input === "string" ? input : input.text;
  const prompt = createPrompt(text, instructions, taskInstructions);
  if (typeof input === "string" || input.images.length === 0) return prompt;
  return [{ type: "text", text: prompt }, ...input.images.map(({ path }) => ({ type: "local_image" as const, path: requireImagePath(path) }))];
}

function requireImagePath(value: string): string { const path = value.trim(); if (!path) throw new Error("AI image path is required"); return path; }

export function createCapabilityFollowUp(name: string, output: unknown): CodexInput {
  const text = [
    `PLAIOS executed "${name}".`,
    "",
    "Capability result:",
    serialize(output),
    "",
    "Continue the original request. If the result includes a screenshot or localPath image, look at the image before answering.",
    "Call another capability if another step is still needed, otherwise return the final answer.",
  ].join("\n");
  const images = imagesFromCapabilityOutput(output);
  return images.length > 0 ? [{ type: "text", text }, ...images] : text;
}

function imagesFromCapabilityOutput(output: unknown): Array<{ type: "local_image"; path: string }> {
  if (!isRecord(output) || !isRecord(output.data)) return [];
  const path = typeof output.data.localPath === "string" ? output.data.localPath.trim() : "";
  if (!path || !/\.(png|jpe?g|webp|gif)$/i.test(path)) return [];
  return [{ type: "local_image", path }];
}

function createFunctionInstructions(definitions: readonly AIExecutableFunctionDefinition[]): string { return ["Choose whether to call one PLAIOS capability or return the final answer.", "For a function call, set type to function-call and provide its exact name and arguments.", "Set finishOnSuccess to true only for one unambiguous state-changing command when no result data, follow-up capability, delay, or additional action is needed. In that case, write a short natural confirmation in the user's language in text; it will be sent only after the capability reports success.", "For reads, questions, uncertain targets, delayed, visual, or multi-step requests, set finishOnSuccess to false and text to null so you can inspect the capability result, including any screenshot.", "If a capability returns a screenshot or localPath image, look at that image before describing what you see.", "For a final answer, set type to text, name to an empty string, arguments to null, finishOnSuccess to false, and provide text.", "Available PLAIOS capabilities:", serialize(definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))].join("\n"); }

function createFunctionStepSchema(definitions: readonly AIExecutableFunctionDefinition[]) {
  return { type: "object", properties: { type: { type: "string", enum: ["text", "function-call"] }, name: { type: "string", enum: ["", ...definitions.map(({ name }) => name)] }, arguments: { anyOf: [{ type: "null" }, ...definitions.map(({ inputSchema }) => normalizeCodexOutputSchema(inputSchema))] }, text: { type: ["string", "null"] }, finishOnSuccess: { type: "boolean" } }, required: ["type", "name", "arguments", "text", "finishOnSuccess"], additionalProperties: false } as const;
}

export function normalizeCodexOutputSchema(schema: JsonSchema): JsonSchema { return normalizeSchemaNode(schema) as JsonSchema; }
function normalizeSchemaNode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchemaNode);
  if (!isRecord(value)) return value;
  const normalized = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeSchemaNode(entry)]));
  if (!isRecord(value.properties)) return normalized;
  const originallyRequired = new Set(Array.isArray(value.required) ? value.required.filter((entry): entry is string => typeof entry === "string") : []);
  const properties = Object.fromEntries(Object.entries(value.properties).map(([key, propertySchema]) => { const property = normalizeSchemaNode(propertySchema); return [key, originallyRequired.has(key) || allowsNull(property) ? property : { anyOf: [property, { type: "null" }] }]; }));
  return { ...normalized, properties, required: Object.keys(properties), additionalProperties: false };
}

function allowsNull(value: unknown): boolean { if (!isRecord(value)) return false; if (value.type === "null") return true; if (Array.isArray(value.type) && value.type.includes("null")) return true; if (Array.isArray(value.enum) && value.enum.includes(null)) return true; return ["anyOf", "oneOf"].some((key) => Array.isArray(value[key]) && value[key].some(allowsNull)); }
function parseFunctionStep(value: string): FunctionStep { const parsed = parseJson<Record<string, unknown>>(value, "function step"); if ((parsed.type !== "text" && parsed.type !== "function-call") || typeof parsed.name !== "string" || (parsed.text !== null && typeof parsed.text !== "string") || typeof parsed.finishOnSuccess !== "boolean") throw new Error("Codex returned an invalid function step"); return { type: parsed.type, name: parsed.name, arguments: parsed.arguments, text: parsed.text, finishOnSuccess: parsed.finishOnSuccess }; }
export function shouldFinishAfterCapability(step: Pick<FunctionStep, "type" | "text" | "finishOnSuccess">, output: unknown): boolean { return step.type === "function-call" && step.finishOnSuccess && typeof step.text === "string" && step.text.trim().length > 0 && isRecord(output) && output.success === true; }
function validateDefinitions(definitions: readonly AIFunctionDefinition[]): void { const names = new Set<string>(); for (const definition of definitions) { validateDefinition(definition); if (names.has(definition.name)) throw new Error(`Duplicate AI function name: "${definition.name}"`); names.add(definition.name); } }
function validateDefinition(definition: AIFunctionDefinition): void { if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) throw new Error(`Invalid AI function name: "${definition.name}"`); }
function parseJson<T>(value: string, label: string): T { try { return JSON.parse(value) as T; } catch (error) { throw new Error(`Codex returned invalid JSON for ${label}`, { cause: error }); } }
function serialize(value: unknown): string { try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); } }
function resolveSignal(defaults: Readonly<AIModelSettings>, options: Pick<AIProcessOptions, "settings" | "signal">): AbortSignal | undefined { const timeoutMs = options.settings?.timeoutMs ?? defaults.timeoutMs; const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, timeoutMs)); if (options.signal && timeoutSignal) return AbortSignal.any([options.signal, timeoutSignal]); return options.signal ?? timeoutSignal; }
interface RunOptions { outputSchema?: unknown; signal?: AbortSignal }
interface ThreadEvent { type: string; item?: { type: string; text?: string }; error?: { message: string }; message?: string }
interface RunnableThread {
  run(input: CodexInput, options?: RunOptions): Promise<{ finalResponse: string }>;
  runStreamed?(input: CodexInput, options?: RunOptions): Promise<{ events: AsyncIterable<ThreadEvent> }>;
}

/** Yields the agent's message text as it grows; the last value is the complete response. */
async function* agentMessages(thread: RunnableThread, input: CodexInput, options: RunOptions): AsyncGenerator<string> {
  if (!thread.runStreamed) { yield (await thread.run(input, options)).finalResponse; return; }
  let last = "";
  for await (const event of (await thread.runStreamed(input, options)).events) {
    if (event.type === "turn.failed") throw new Error(event.error?.message ?? "Codex turn failed");
    if (event.type === "error") throw new Error(event.message ?? "Codex stream error");
    if ((event.type === "item.updated" || event.type === "item.completed") && event.item?.type === "agent_message" && typeof event.item.text === "string") {
      last = event.item.text;
      yield last;
    }
  }
}

async function* streamText(thread: RunnableThread, input: CodexInput, signal?: AbortSignal): AsyncGenerator<string> {
  let sent = 0;
  for await (const text of agentMessages(thread, input, { signal })) { if (text.length > sent) { yield text.slice(sent); sent = text.length; } }
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
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
