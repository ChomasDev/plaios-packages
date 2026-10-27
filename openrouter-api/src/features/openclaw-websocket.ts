import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type {
  InputListener,
  InputMessage,
  OutputContent,
} from "@plaios/core/domain";
import { WebSocket, WebSocketServer } from "ws";
import type { OpenRouterApiModel } from "./types.js";
import { isRecord, normalizeText as textValue } from "./utils.js";

type JsonRecord = Record<string, unknown>;
type ChatMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
  timestamp: number;
};
type ActiveRun = {
  socket: WebSocket;
  runId: string;
  sessionKey: string;
  seq: number;
  aborted: boolean;
};

const METHODS = [
  "health",
  "status",
  "models.list",
  "agents.list",
  "sessions.list",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.reset",
  "chat.history",
  "chat.send",
  "chat.abort",
] as const;

const EVENTS = ["connect.challenge", "chat", "tick"] as const;

export class OpenClawWebSocketGateway {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly runs = new AsyncLocalStorage<ActiveRun>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly history = new Map<string, ChatMessage[]>();
  private readonly startedAt = Date.now();
  private listener?: InputListener;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly models: readonly OpenRouterApiModel[],
    private readonly backendModel = "agent-os",
    private readonly backendProvider = "agent-os",
    private readonly userId?: string,
  ) {}

  attach(server: Server, listener: InputListener): void {
    this.listener = listener;
    server.on("upgrade", (request, socket, head) => {
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.server.emit("connection", webSocket, request);
      });
    });
    this.server.on("connection", (socket) => this.accept(socket));
  }

  async stop(): Promise<void> {
    for (const socket of this.server.clients) socket.close(1001, "server stopping");
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get active(): boolean {
    return this.runs.getStore() !== undefined;
  }

  async write(content: OutputContent): Promise<void> {
    const run = this.runs.getStore();
    if (!run) throw new Error("No active OpenClaw WebSocket chat request");
    if (run.aborted) return;

    if (typeof content === "string") {
      this.sendFinal(run, content);
      return;
    }

    let fullText = "";
    for await (const chunk of content) {
      if (run.aborted) return;
      fullText += chunk;
      run.seq += 1;
      this.event(run.socket, "chat", {
        runId: run.runId,
        sessionKey: run.sessionKey,
        seq: run.seq,
        state: "delta",
        deltaText: chunk,
        message: assistantMessage(fullText),
      });
    }
    if (!run.aborted) this.sendFinal(run, fullText);
  }

  private accept(socket: WebSocket): void {
    const nonce = randomUUID();
    this.event(socket, "connect.challenge", { nonce, ts: Date.now() });
    socket.on("message", (data) => {
      void this.handle(socket, data.toString()).catch((error: unknown) => {
        this.error(socket, "unknown", error instanceof Error ? error.message : String(error));
      });
    });
  }

  private async handle(socket: WebSocket, raw: string): Promise<void> {
    let frame: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("frame must be an object");
      frame = parsed;
    } catch {
      this.error(socket, "unknown", "invalid JSON frame");
      return;
    }
    if (frame.type !== "req" || typeof frame.id !== "string" || typeof frame.method !== "string") {
      this.error(socket, typeof frame.id === "string" ? frame.id : "unknown", "invalid request frame");
      return;
    }
    const params = isRecord(frame.params) ? frame.params : {};

    if (frame.method === "connect") {
      this.connect(socket, frame.id, params);
      return;
    }
    switch (frame.method) {
      case "health":
      case "status":
        this.ok(socket, frame.id, this.health());
        return;
      case "models.list":
        this.ok(socket, frame.id, { models: [{
          id: this.backendModel,
          name: this.backendModel,
          provider: this.backendProvider,
        }] });
        return;
      case "agents.list":
        this.ok(socket, frame.id, this.agents());
        return;
      case "sessions.list":
        this.ok(socket, frame.id, this.sessions());
        return;
      case "sessions.subscribe":
      case "sessions.unsubscribe":
        this.ok(socket, frame.id, { ok: true });
        return;
      case "sessions.reset":
        this.reset(socket, frame.id, params);
        return;
      case "chat.history":
        this.chatHistory(socket, frame.id, params);
        return;
      case "chat.abort":
        this.chatAbort(socket, frame.id, params);
        return;
      case "chat.send":
        await this.chatSend(socket, frame.id, params);
        return;
      default:
        this.error(socket, frame.id, `unknown method: ${frame.method}`);
    }
  }

  private connect(socket: WebSocket, id: string, params: JsonRecord): void {
    const min = numberValue(params.minProtocol);
    const max = numberValue(params.maxProtocol);
    if (min > 4 || max < 4) {
      this.error(socket, id, "incompatible protocol version");
      return;
    }
    const auth = isRecord(params.auth) ? params.auth : {};
    if (this.apiKey && auth.token !== this.apiKey && auth.password !== this.apiKey) {
      this.error(socket, id, "invalid gateway credential");
      return;
    }
    this.ok(socket, id, {
      type: "hello-ok",
      protocol: 4,
      server: { version: "agent-os-openclaw-compat", connId: randomUUID() },
      features: { methods: [...METHODS], events: [...EVENTS] },
      snapshot: {
        presence: [],
        health: this.health(),
        stateVersion: { presence: 0, health: 0 },
        uptimeMs: Date.now() - this.startedAt,
        sessionDefaults: {
          defaultAgentId: "main",
          mainKey: "main",
          mainSessionKey: "agent:main:main",
          scope: "per-sender",
        },
        authMode: this.apiKey ? "token" : "none",
      },
      auth: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      },
      policy: {
        maxPayload: 1_048_576,
        maxBufferedBytes: 1_048_576,
        tickIntervalMs: 30_000,
      },
    });
  }

  private async chatSend(socket: WebSocket, id: string, params: JsonRecord): Promise<void> {
    const sessionKey = textValue(params.sessionKey);
    const message = typeof params.message === "string" ? params.message : undefined;
    const runId = textValue(params.idempotencyKey);
    if (!sessionKey || message === undefined || !runId) {
      this.error(socket, id, "chat.send requires sessionKey, message, and idempotencyKey");
      return;
    }
    if (this.activeRuns.has(runId)) {
      this.ok(socket, id, { runId, status: "in_flight" });
      return;
    }

    const run: ActiveRun = { socket, runId, sessionKey, seq: 0, aborted: false };
    this.activeRuns.set(runId, run);
    this.append(sessionKey, userMessage(message));
    this.ok(socket, id, { runId, status: "started" });

    const input: InputMessage = {
      id: `input-${randomUUID()}`,
      channel: "openrouter-api",
      sessionId: sessionKey,
      userId: this.userId,
      text: message,
      createdAt: new Date(),
      metadata: {
        preferredOutputChannel: "openrouter-api",
        requestId: runId,
        transport: "openclaw-websocket",
        thinking: textValue(params.thinking),
      },
    };

    void this.runs.run(run, async () => {
      try {
        await this.listener?.(input);
      } catch (error) {
        if (!run.aborted) {
          run.seq += 1;
          this.event(socket, "chat", {
            runId,
            sessionKey,
            seq: run.seq,
            state: "error",
            errorMessage: error instanceof Error ? error.message : String(error),
            errorKind: "unknown",
          });
        }
      } finally {
        this.activeRuns.delete(runId);
      }
    });
  }

  private chatHistory(socket: WebSocket, id: string, params: JsonRecord): void {
    const sessionKey = textValue(params.sessionKey);
    if (!sessionKey) {
      this.error(socket, id, "chat.history requires sessionKey");
      return;
    }
    const all = this.history.get(sessionKey) ?? [];
    const limit = Math.min(1000, Math.max(1, numberValue(params.limit) || 200));
    this.ok(socket, id, {
      sessionKey,
      messages: all.slice(-limit),
      thinkingLevel: "off",
    });
  }

  private chatAbort(socket: WebSocket, id: string, params: JsonRecord): void {
    const sessionKey = textValue(params.sessionKey);
    const requestedRunId = textValue(params.runId);
    const matched = [...this.activeRuns.values()].filter((run) =>
      run.sessionKey === sessionKey && (!requestedRunId || run.runId === requestedRunId));
    for (const run of matched) {
      run.aborted = true;
      run.seq += 1;
      this.event(run.socket, "chat", {
        runId: run.runId,
        sessionKey: run.sessionKey,
        seq: run.seq,
        state: "aborted",
        stopReason: "aborted",
      });
      this.activeRuns.delete(run.runId);
    }
    this.ok(socket, id, { ok: true, aborted: matched.length > 0, runIds: matched.map((run) => run.runId) });
  }

  private reset(socket: WebSocket, id: string, params: JsonRecord): void {
    const key = textValue(params.key);
    if (!key) {
      this.error(socket, id, "sessions.reset requires key");
      return;
    }
    this.history.delete(key);
    this.ok(socket, id, { ok: true, key });
  }

  private sendFinal(run: ActiveRun, text: string): void {
    const message = assistantMessage(text);
    this.append(run.sessionKey, message);
    run.seq += 1;
    this.event(run.socket, "chat", {
      runId: run.runId,
      sessionKey: run.sessionKey,
      seq: run.seq,
      state: "final",
      message,
      stopReason: "stop",
    });
  }

  private append(sessionKey: string, message: ChatMessage): void {
    const messages = this.history.get(sessionKey) ?? [];
    messages.push(message);
    this.history.set(sessionKey, messages.slice(-1000));
  }

  private agents() {
    const ids = new Set<string>();
    for (const model of this.models) {
      if (model.id.startsWith("openclaw/") && model.id !== "openclaw/default") {
        ids.add(model.id.slice("openclaw/".length));
      }
    }
    if (ids.size === 0) ids.add("main");
    return {
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender",
      agents: [...ids].map((agentId) => ({
        id: agentId,
        name: agentId,
        agentRuntime: { id: this.backendProvider, source: "model" },
        model: { primary: `${this.backendProvider}/${this.backendModel}` },
      })),
    };
  }

  private sessions() {
    return {
      ts: Date.now(),
      path: "memory://openclaw-websocket",
      count: this.history.size,
      totalCount: this.history.size,
      defaults: { model: this.backendModel, modelProvider: this.backendProvider },
      sessions: [...this.history.entries()].map(([key, messages]) => ({
        key,
        updatedAt: messages.at(-1)?.timestamp,
        lastMessagePreview: messages.at(-1)?.content[0]?.text.slice(0, 160),
      })),
    };
  }

  private health() {
    return { ok: true, status: "ok", service: "agent-os-openclaw-chat" };
  }

  private ok(socket: WebSocket, id: string, payload: unknown): void {
    this.send(socket, { type: "res", id, ok: true, payload });
  }

  private error(socket: WebSocket, id: string, message: string): void {
    this.send(socket, {
      type: "res",
      id,
      ok: false,
      error: { code: "INVALID_REQUEST", message },
    });
  }

  private event(socket: WebSocket, event: string, payload: unknown): void {
    this.send(socket, { type: "event", event, payload });
  }

  private send(socket: WebSocket, frame: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }
}

function assistantMessage(text: string): ChatMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now() };
}

function userMessage(text: string): ChatMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
