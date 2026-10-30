import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { query, type EffortLevel, type Options, type Query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AIExecutableFunctionDefinition, AIFunctionCallResult, AIFunctionDefinition, AIFunctionProcessOptions, AIImageInput, AIInput, AIModelSettings, AIProcessOptions, AIProcessResult, System2, SystemAnswers, SystemAskOptions, SystemQuestions } from "@plaios/core";
import { askWithFunctionCall } from "@plaios/systems";
import {
  createCapabilityFollowUp,
  createFunctionInstructions,
  createFunctionStepSchema,
  imageFromCapabilityOutput,
  normalizeOutputSchema,
  parseFunctionStep,
  partialFinalText,
  shouldFinishAfterCapability,
  validateDefinition,
  validateDefinitions,
} from "./steps.js";

export * from "./steps.js";

export interface ClaudeCodeProviderOptions {
  model?: string;
  /** Anthropic API key; without one the local Claude Code login (claude.ai subscription) is used. */
  apiKey?: string;
  effort?: EffortLevel;
  workingDirectory?: string;
  settings?: AIModelSettings;
  pathToClaudeCodeExecutable?: string;
}

type UserContent = SDKUserMessage["message"]["content"];

const DEFAULT_MODEL = "claude-opus-5-5";
const providerInstructions = [
  "You are the model inside PLAIOS.",
  "You have no workspace and no built-in tools.",
  "Use only the request and the PLAIOS capabilities explicitly described in it.",
].join(" ");
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export class ClaudeCodeProvider implements System2 {
  readonly provider = "claude-code" as const;
  readonly model: string;
  readonly settings: Readonly<AIModelSettings>;
  private readonly options: ClaudeCodeProviderOptions;
  private readonly workingDirectory: string;

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.settings = Object.freeze({ ...options.settings });
    this.options = options;
    this.workingDirectory = options.workingDirectory ?? process.cwd();
  }

  microfrontendData() {
    return {
      provider: this.provider,
      model: this.model,
      effort: this.options.effort ?? "model default",
      credentialMode: this.options.apiKey || process.env.ANTHROPIC_API_KEY ? "api-key" : "claude-code-session",
      workingDirectory: this.workingDirectory,
    };
  }

  async processInput(input: AIInput, options: AIProcessOptions = {}): Promise<AIProcessResult> {
    const stream = this.streamPlain(input, options);
    if (options.stream) return { type: "stream", stream };
    let text = "";
    for await (const chunk of stream) text += chunk;
    return { type: "text", text };
  }

  ask(state: Record<string, unknown>, questions: SystemQuestions, options?: SystemAskOptions): Promise<SystemAnswers> {
    return askWithFunctionCall(this, state, questions, options);
  }

  async functionCall<TArguments>(input: string, definition: AIFunctionDefinition<TArguments>, options: Omit<AIProcessOptions, "stream"> = {}): Promise<AIFunctionCallResult<TArguments>> {
    validateDefinition(definition);
    const session = this.open(options, normalizeOutputSchema(definition.inputSchema), `Return the arguments for the required "${definition.name}" function.\nFunction description: ${definition.description}`);
    try {
      const result = await lastResult(session.turn(await userContent(input)));
      return { type: "function-call", name: definition.name, callId: `claude-code-${randomUUID()}`, arguments: structuredOutput(result) as TArguments };
    } finally {
      session.close();
    }
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

  private async *streamPlain(input: AIInput, options: AIProcessOptions): AsyncGenerator<string> {
    const session = this.open(options);
    try {
      let streamed = false;
      for await (const message of session.turn(await userContent(input))) {
        if (message.type === "result") { if (!streamed && message.subtype === "success") yield message.result; return; }
        const delta = textDelta(message);
        if (delta) { streamed = true; yield delta; }
      }
    } finally {
      session.close();
    }
  }

  /** One Claude Code session for the whole loop: each capability result is a follow-up turn, not a new process. */
  private async *runFunctionLoop(input: AIInput, definitions: readonly AIExecutableFunctionDefinition[], options: AIFunctionProcessOptions): AsyncGenerator<string> {
    const session = this.open(options, createFunctionStepSchema(definitions), createFunctionInstructions(definitions));
    const maxSteps = Math.max(1, options.maxSteps ?? 100);
    try {
      let content = await userContent(input);
      for (let step = 0; step < maxSteps; step += 1) {
        // Stream the final answer's `text` while the step JSON is still arriving; tool-call steps stay buffered.
        let json = "";
        let sent = 0;
        let result: SDKResultMessage | undefined;
        for await (const item of session.turn(content)) {
          if (item.type === "result") { result = item; break; }
          const partial = structuredDelta(item);
          if (partial === undefined) continue;
          json += partial;
          const decoded = partialFinalText(json);
          if (decoded !== undefined && decoded.length > sent) { yield decoded.slice(sent); sent = decoded.length; }
        }
        const requested = parseFunctionStep(structuredOutput(result!));
        if (requested.type === "text") {
          if (typeof requested.text !== "string") throw new Error("Claude Code returned a final step without text");
          const rest = requested.text.slice(sent);
          if (rest) yield rest;
          return;
        }
        const definition = definitions.find((candidate) => candidate.name === requested.name);
        if (!definition) throw new Error(`Claude Code requested unknown function "${requested.name}"`);
        const output = await definition.execute(requested.arguments, { callId: `claude-code-${randomUUID()}`, signal: options.signal });
        if (shouldFinishAfterCapability(requested, output)) { yield requested.text!; return; }
        const image = imageFromCapabilityOutput(output);
        content = await userContent({ text: createCapabilityFollowUp(definition.name, output), images: image ? [{ path: image }] : [] });
      }
      throw new Error(`Claude Code exceeded the ${maxSteps}-step function-call limit`);
    } finally {
      session.close();
    }
  }

  private open(options: AIProcessOptions, schema?: Record<string, unknown>, taskInstructions?: string): Session {
    const controller = new AbortController();
    const signal = resolveSignal(this.settings, options);
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const sdkOptions: Options = {
      model: this.model,
      ...(this.options.effort ? { effort: this.options.effort } : {}),
      cwd: this.workingDirectory,
      systemPrompt: [providerInstructions, options.instructions?.trim(), taskInstructions?.trim()].filter(Boolean).join("\n\n"),
      // PLAIOS is the only tool provider: no built-in tools, no user settings, CLAUDE.md, hooks or MCP servers, nothing saved to ~/.claude.
      tools: [],
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      includePartialMessages: true,
      abortController: controller,
      ...(schema ? { outputFormat: { type: "json_schema", schema } } : {}),
      ...(this.options.apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: this.options.apiKey } } : {}),
      ...(this.options.pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable } : {}),
    };
    return new Session(sdkOptions);
  }
}

/** A Claude Code process fed through streaming input, so several turns share it. */
class Session {
  private readonly inbox = new Inbox<SDKUserMessage>();
  private readonly query: Query;

  constructor(options: Options) {
    this.query = query({ prompt: this.inbox, options });
  }

  /** Sends one user message and yields every message of the reply, ending with its result. */
  async *turn(content: UserContent): AsyncGenerator<SDKMessage> {
    this.inbox.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null });
    for (;;) {
      // next() rather than for-await: leaving a for-await would end the whole query.
      const { value, done } = await this.query.next();
      if (done) throw new Error("Claude Code ended the session before answering");
      if (value.type === "result") {
        if (value.subtype !== "success" || value.is_error) throw new Error(`Claude Code failed (${value.subtype}${value.subtype === "success" ? `: ${value.result}` : ""})`);
        yield value;
        return;
      }
      yield value;
    }
  }

  close(): void {
    this.inbox.close();
    this.query.close();
  }
}

/** Minimal async queue for the SDK's streaming input. */
class Inbox<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting?: (result: IteratorResult<T>) => void;
  private closed = false;

  push(item: T): void {
    if (this.waiting) { const resolve = this.waiting; this.waiting = undefined; resolve({ value: item, done: false }); } else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
    };
  }
}

/** PLAIOS input as a Messages API user content: text, then any images read from disk. */
export async function userContent(input: AIInput): Promise<UserContent> {
  const text = (typeof input === "string" ? input : input.text).trim();
  if (!text) throw new Error("AI input is required");
  const images = typeof input === "string" ? [] : input.images;
  if (images.length === 0) return text;
  return [{ type: "text", text }, ...(await Promise.all(images.map(imageBlock)))] as UserContent;
}

async function imageBlock(image: AIImageInput) {
  const path = image.path.trim();
  if (!path) throw new Error("AI image path is required");
  const mediaType = image.mediaType ?? IMAGE_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`Unsupported image type: ${path}`);
  return { type: "image", source: { type: "base64", media_type: mediaType, data: (await readFile(path)).toString("base64") } };
}

function textDelta(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event" || message.parent_tool_use_id !== null) return undefined;
  const event = message.event;
  return event.type === "content_block_delta" && event.delta.type === "text_delta" ? event.delta.text : undefined;
}

/** Structured output arrives as the input of Claude Code's StructuredOutput tool call; these are its JSON fragments. */
function structuredDelta(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event" || message.parent_tool_use_id !== null) return undefined;
  const event = message.event;
  return event.type === "content_block_delta" && event.delta.type === "input_json_delta" ? event.delta.partial_json : undefined;
}

async function lastResult(messages: AsyncIterable<SDKMessage>): Promise<SDKResultMessage> {
  for await (const message of messages) if (message.type === "result") return message;
  throw new Error("Claude Code ended the session before answering");
}

function structuredOutput(result: SDKResultMessage): unknown {
  if (result.subtype !== "success" || result.structured_output === undefined) throw new Error("Claude Code returned no structured output");
  return result.structured_output;
}

function resolveSignal(defaults: Readonly<AIModelSettings>, options: Pick<AIProcessOptions, "settings" | "signal">): AbortSignal | undefined {
  const timeoutMs = options.settings?.timeoutMs ?? defaults.timeoutMs;
  const timeoutSignal = timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, timeoutMs));
  if (options.signal && timeoutSignal) return AbortSignal.any([options.signal, timeoutSignal]);
  return options.signal ?? timeoutSignal;
}

