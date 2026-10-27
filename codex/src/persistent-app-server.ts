import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import type { ApprovalMode, CodexOptions, Input as CodexInput, ModelReasoningEffort, SandboxMode, WebSearchMode } from "@openai/codex-sdk";

export interface PersistentThreadOptions {
  model: string;
  workingDirectory: string;
  skipGitRepoCheck: boolean;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalMode;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
}

interface PersistentRunOptions {
  onDelta?: (delta: string) => void;
  outputSchema?: unknown;
  signal?: AbortSignal;
}

interface PersistentRunResult {
  finalResponse: string;
}

interface AppServerOptions {
  apiKey?: string;
  baseUrl?: string;
  codexPathOverride?: string;
  config?: CodexOptions["config"];
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

type NotificationListener = (message: JsonRpcMessage) => void;

export class PersistentCodexAppServer {
  private child: ChildProcessWithoutNullStreams | undefined;
  private starting: Promise<void> | undefined;
  private closed = false;
  private nextRequestId = 1;
  private stdoutBuffer = "";
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly listeners = new Set<NotificationListener>();
  private readonly stderr: string[] = [];

  constructor(private readonly options: AppServerOptions) {}

  startThread(options: PersistentThreadOptions): PersistentCodexThread {
    return new PersistentCodexThread(this, options);
  }

  async runTurn(threadOptions: PersistentThreadOptions, existingThreadId: string | null, input: CodexInput, options: PersistentRunOptions): Promise<{ threadId: string; result: PersistentRunResult }> {
    await this.ensureStarted();
    const threadId = existingThreadId ?? await this.createThread(threadOptions);
    const completion = this.waitForTurn(threadId, options.signal, options.onDelta);
    try {
      const response = asRecord(await this.request("turn/start", {
        threadId,
        input: toUserInput(input),
        cwd: threadOptions.workingDirectory,
        approvalPolicy: threadOptions.approvalPolicy,
        model: threadOptions.model,
        effort: threadOptions.modelReasoningEffort ?? null,
        outputSchema: options.outputSchema ?? null,
      }));
      const turn = asRecord(response.turn);
      const turnId = requireString(turn.id, "Codex app-server turn id");
      completion.setTurnId(turnId);
      return { threadId, result: { finalResponse: await completion.result } };
    } catch (error) {
      completion.cancel();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const child = this.child;
    this.child = undefined;
    this.starting = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  private async createThread(options: PersistentThreadOptions): Promise<string> {
    const config: Record<string, unknown> = {
      web_search: options.webSearchMode,
      sandbox_workspace_write: { network_access: options.networkAccessEnabled },
    };
    const response = asRecord(await this.request("thread/start", {
      model: options.model,
      cwd: options.workingDirectory,
      approvalPolicy: options.approvalPolicy,
      sandbox: options.sandboxMode,
      config,
      ephemeral: true,
    }));
    return requireString(asRecord(response.thread).id, "Codex app-server thread id");
  }

  private waitForTurn(threadId: string, signal?: AbortSignal, onDelta?: (delta: string) => void): { result: Promise<string>; setTurnId(value: string): void; cancel(): void } {
    let turnId: string | undefined;
    let finalResponse = "";
    let settled = false;
    let resolveResult!: (value: string) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    void result.catch(() => undefined);
    const cleanup = () => {
      this.listeners.delete(onMessage);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (value: string | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (value instanceof Error) rejectResult(value);
      else resolveResult(value);
    };
    const onMessage = (message: JsonRpcMessage) => {
      const params = asOptionalRecord(message.params);
      if (message.method === "process/error") {
        settle(new Error(typeof params?.message === "string" ? params.message : "Codex app-server stopped"));
        return;
      }
      if (!params || params.threadId !== threadId) return;
      if (turnId && typeof params.turnId === "string" && params.turnId !== turnId) return;
      if (message.method === "item/agentMessage/delta") {
        if (typeof params.delta === "string") onDelta?.(params.delta);
        return;
      }
      if (message.method === "item/completed") {
        const item = asOptionalRecord(params.item);
        if (item?.type === "agentMessage" && typeof item.text === "string") finalResponse = item.text;
        return;
      }
      if (message.method === "turn/completed") {
        const turn = asOptionalRecord(params.turn);
        if (turn?.status === "failed") {
          const error = asOptionalRecord(turn.error);
          settle(new Error(typeof error?.message === "string" ? error.message : "Codex turn failed"));
          return;
        }
        const items = Array.isArray(turn?.items) ? turn.items : [];
        for (const value of items) {
          const item = asOptionalRecord(value);
          if (item?.type === "agentMessage" && typeof item.text === "string") finalResponse = item.text;
        }
        settle(finalResponse);
        return;
      }
      if (message.method === "error" && params.willRetry !== true) {
        const error = asOptionalRecord(params.error);
        settle(new Error(typeof error?.message === "string" ? error.message : "Codex turn failed"));
      }
    };
    const onAbort = () => {
      if (turnId) void this.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      settle(signal?.reason instanceof Error ? signal.reason : new Error("Codex turn aborted"));
    };
    this.listeners.add(onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    return {
      result,
      setTurnId(value) { turnId = value; if (signal?.aborted) onAbort(); },
      cancel() { settle(new Error("Codex turn cancelled")); void result.catch(() => undefined); },
    };
  }

  private async ensureStarted(): Promise<void> {
    if (this.closed) throw new Error("Codex app-server is closed");
    if (this.starting) return this.starting;
    if (this.child && this.child.exitCode === null && !this.child.killed) return;
    this.starting = this.start().finally(() => { this.starting = undefined; });
    await this.starting;
  }

  private async start(): Promise<void> {
    const command = resolveCommand(this.options.codexPathOverride);
    const args = [...command.args, "app-server", "--stdio", ...configArguments(this.options.config, this.options.baseUrl)];
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "agent_os" };
    if (this.options.apiKey) env.CODEX_API_KEY = this.options.apiKey;
    const child = spawn(command.executable, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.stdoutBuffer = "";
    this.stderr.length = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr.push(chunk);
      if (this.stderr.length > 20) this.stderr.shift();
    });
    child.once("error", (error) => this.failProcess(error));
    child.once("exit", (code, processSignal) => {
      if (this.child === child) this.child = undefined;
      if (!this.closed) this.failProcess(new Error(`Codex app-server exited with ${processSignal ? `signal ${processSignal}` : `code ${code ?? 1}`}${this.stderr.length ? `: ${this.stderr.join("").trim()}` : ""}`));
    });
    try {
      await this.request("initialize", {
        clientInfo: { name: "agent-os", title: "PLAIOS", version: "0.1.2" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      this.notify("initialized");
    } catch (error) {
      if (this.child === child) this.child = undefined;
      child.kill();
      throw error;
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, id, params })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private notify(method: string, params?: unknown): void {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) return;
    child.stdin.write(`${JSON.stringify(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params })}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonRpcMessage;
      try { message = JSON.parse(line) as JsonRpcMessage; }
      catch { continue; }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
        else pending.resolve(message.result);
        continue;
      }
      if (message.id !== undefined && message.method) {
        this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "PLAIOS does not support this server request" } })}\n`);
        continue;
      }
      for (const listener of this.listeners) listener(message);
    }
  }

  private failProcess(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: "process/error", params: { message: error.message } });
  }
}

class PersistentCodexThread {
  private id: string | null = null;

  constructor(private readonly server: PersistentCodexAppServer, private readonly options: PersistentThreadOptions) {}

  async run(input: CodexInput, options: PersistentRunOptions = {}): Promise<PersistentRunResult> {
    const response = await this.server.runTurn(this.options, this.id, input, options);
    this.id = response.threadId;
    return response.result;
  }

  /** Same shape as the SDK's streamed turn: agent message updates with the text so far, then the complete text. */
  async runStreamed(input: CodexInput, options: PersistentRunOptions = {}): Promise<{ events: AsyncGenerator<{ type: string; item?: { type: string; text?: string } }> }> {
    const queue: string[] = [];
    let text = "";
    let done = false;
    let failure: unknown;
    let wake = () => {};
    void this.run(input, { ...options, onDelta: (delta) => { text += delta; queue.push(text); wake(); } })
      .then((result) => { queue.push(result.finalResponse); })
      .catch((error: unknown) => { failure = error; })
      .finally(() => { done = true; wake(); });
    const events = (async function* () {
      for (;;) {
        while (queue.length) yield { type: "item.updated", item: { type: "agent_message", text: queue.shift()! } };
        if (done) { if (failure) throw failure; return; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    })();
    return { events };
  }
}

function toUserInput(input: CodexInput): unknown[] {
  if (typeof input === "string") return [{ type: "text", text: input, text_elements: [] }];
  return input.map((item) => item.type === "text"
    ? { type: "text", text: item.text, text_elements: [] }
    : { type: "localImage", path: item.path });
}

function resolveCommand(override?: string): { executable: string; args: string[] } {
  if (override) return override.endsWith(".js") || override.endsWith(".mjs")
    ? { executable: process.execPath, args: [override] }
    : { executable: override, args: [] };
  const sdkUrl = import.meta.resolve("@openai/codex-sdk");
  const codexScript = createRequire(sdkUrl).resolve("@openai/codex/bin/codex.js");
  return { executable: process.execPath, args: [codexScript] };
}

function configArguments(config: CodexOptions["config"], baseUrl?: string): string[] {
  const values: string[] = [];
  if (config) flattenConfig(config, "", values);
  if (baseUrl) values.push(`openai_base_url=${JSON.stringify(baseUrl)}`);
  return values.flatMap((value) => ["--config", value]);
}

function flattenConfig(value: unknown, prefix: string, output: string[]): void {
  if (!isPlainRecord(value)) {
    if (!prefix) throw new Error("Codex config overrides must be an object");
    output.push(`${prefix}=${toToml(value, prefix)}`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key) throw new Error("Codex config keys must be non-empty");
    if (child === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainRecord(child) && Object.keys(child).length > 0) flattenConfig(child, path, output);
    else output.push(`${path}=${toToml(child, path)}`);
  }
}

function toToml(value: unknown, path: string): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map((item, index) => toToml(item, `${path}[${index}]`)).join(", ")}]`;
  if (isPlainRecord(value)) return `{${Object.entries(value).map(([key, child]) => `${/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key)} = ${toToml(child, `${path}.${key}`)}`).join(", ")}}`;
  throw new Error(`Unsupported Codex config value at ${path}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  const record = asOptionalRecord(value);
  if (!record) throw new Error("Codex app-server returned an invalid response");
  return record;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!asOptionalRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is missing`);
  return value;
}
