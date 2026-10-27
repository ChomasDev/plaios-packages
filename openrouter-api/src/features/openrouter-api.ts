import {
  createServer,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  InputInterface,
  InputListener,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";
import { defaultOpenRouterApiLog, safeLog } from "./logger.js";
import { OpenClawWebSocketGateway } from "./openclaw-websocket.js";
import { RequestHandler } from "./request-handler.js";
import { ResponseCoordinator } from "./response-coordinator.js";
import { close, listen } from "./server-lifecycle.js";
import type {
  OpenRouterApiInputOptions,
  OpenRouterApiModel,
  ResolvedOpenRouterApiOptions,
} from "./types.js";

const DEFAULT_CHAT_PATHS = [
  "/v1/chat/completions",
  "/api/v1/chat/completions",
] as const;

export class OpenRouterApiInput implements InputInterface, OutputInterface {
  readonly channel = "openrouter-api" as const;
  readonly description =
    "The OpenRouter-compatible HTTP request that originated this message";

  private readonly options: ResolvedOpenRouterApiOptions;
  private readonly models: readonly OpenRouterApiModel[];
  private readonly requests: RequestHandler;
  private readonly responses = new ResponseCoordinator();
  private readonly webSocket?: OpenClawWebSocketGateway;
  private server?: Server;
  private listening = false;
  private stopped?: Promise<void>;
  private resolveStopped?: () => void;

  constructor(options: OpenRouterApiInputOptions = {}) {
    this.options = resolveOptions(options);
    this.models = resolveModels(options.models, options.openClawCompatibility === true);
    this.requests = new RequestHandler(
      this.options,
      this.models,
      this.responses,
    );
    if (options.openClawCompatibility === true) {
      this.webSocket = new OpenClawWebSocketGateway(
        this.options.apiKey,
        this.models,
        options.backendModel,
        options.backendProvider,
        options.userId,
      );
    }
  }

  get address(): AddressInfo | string | null {
    return this.server?.address() ?? null;
  }

  microfrontendData() {
    const address = this.address;
    return {
      service: "agent-os-openrouter-api",
      channel: this.channel,
      listening: this.listening,
      address: typeof address === "object" && address
        ? { address: address.address, family: address.family, port: address.port }
        : address,
      hostname: this.options.hostname,
      configuredPort: this.options.port,
      authRequired: Boolean(this.options.apiKey),
      openClawCompatibility: this.options.openClawCompatibility === true,
      models: this.models.map(({ id }) => id),
      endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/models", "/health"],
      transports: this.webSocket ? ["http", "sse", "websocket"] : ["http", "sse"],
    };
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("OpenRouterApiInput listener is already running");
    }

    this.prepareServer(listener);
    try {
      await listen(this.server!, this.options.port, this.options.hostname);
      this.logListening();
      await this.stopped;
    } catch (error) {
      this.listening = false;
      this.resolveStopped?.();
      throw error;
    } finally {
      this.resetServer();
    }
  }

  async stop(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    await this.webSocket?.stop();
    if (this.server?.listening) await close(this.server);
    safeLog(this.options.onLog, { type: "stopped" });
    this.resolveStopped?.();
  }

  write(content: OutputContent): Promise<void> {
    if (this.responses.active) return this.responses.write(content);
    if (this.webSocket?.active) return this.webSocket.write(content);
    return Promise.reject(
      new Error("OpenRouterApiInput.write must run inside an active HTTP or WebSocket request"),
    );
  }

  private prepareServer(listener: InputListener): void {
    this.listening = true;
    this.stopped = new Promise<void>((resolveStopped) => {
      this.resolveStopped = resolveStopped;
    });
    this.server = createServer((request, response) => {
      void this.requests.handle(request, response, listener);
    });
    this.webSocket?.attach(this.server, listener);
    this.server.on("clientError", (_error, socket) => {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
  }

  private logListening(): void {
    const address = this.address;
    const port =
      typeof address === "object" && address
        ? address.port
        : this.options.port;
    safeLog(this.options.onLog, {
      type: "listening",
      url: `http://${this.options.hostname}:${port}`,
    });
  }

  private resetServer(): void {
    this.server = undefined;
    this.stopped = undefined;
    this.resolveStopped = undefined;
    this.listening = false;
  }
}

function resolveOptions(
  options: OpenRouterApiInputOptions,
): ResolvedOpenRouterApiOptions {
  return {
    ...options,
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 3000,
    maxBodyBytes: Math.max(1, options.maxBodyBytes ?? 1_048_576),
    chatCompletionsPaths: options.chatCompletionsPaths ?? DEFAULT_CHAT_PATHS,
    corsOrigins: normalizeCorsOrigins(options.corsOrigins),
    onLog:
      options.onLog ??
      (options.log === false ? undefined : defaultOpenRouterApiLog),
  };
}

function resolveModels(
  models: OpenRouterApiInputOptions["models"],
  openClawCompatibility: boolean,
): readonly OpenRouterApiModel[] {
  const defaults = openClawCompatibility
    ? ["openclaw", "openclaw/default"]
    : ["agent-os"];
  const configured = typeof models === "string"
    ? models.split(",").map((value) => value.trim()).filter(Boolean)
    : models;
  return (configured?.length ? configured : defaults).map((model) =>
    typeof model === "string" ? { id: model } : model,
  );
}

function normalizeCorsOrigins(value: OpenRouterApiInputOptions["corsOrigins"]): "*" | readonly string[] | false | undefined {
  if (value === undefined || value === false || value === "*") return value;
  if (typeof value === "string") {
    const origins = value.split(",").map((origin) => origin.trim()).filter(Boolean);
    return origins.length ? origins : false;
  }
  return value;
}
