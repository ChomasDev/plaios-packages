import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { InputListener, InputMessage } from "@agent-os/core/domain";
import { writeCompletion, writeSse } from "./completion-response.js";
import {
  lastUserMessageText,
  renderConversation,
  renderResponsesInput,
} from "./conversation.js";
import { HttpError } from "./http-error.js";
import { writeError, writeJson } from "./http-response.js";
import { safeLog } from "./logger.js";
import { applyCors, authorize } from "./request-policy.js";
import {
  parseChatCompletionRequest,
  parseResponsesRequest,
  readJsonBody,
} from "./request-parser.js";
import { writeResponsesCompletion, writeResponsesSse } from "./responses-response.js";
import { ResponseCoordinator } from "./response-coordinator.js";
import type {
  ChatCompletionRequest,
  OpenRouterApiLogEvent,
  OpenRouterApiModel,
  ResolvedOpenRouterApiOptions,
  ResponseContext,
  ResponsesRequest,
} from "./types.js";
import { firstHeader, normalizeText, toAsyncIterable } from "./utils.js";

const MODEL_PATHS = new Set(["/v1/models", "/api/v1/models"]);
const RESPONSES_PATHS = new Set(["/v1/responses", "/api/v1/responses"]);

export class RequestHandler {
  constructor(
    private readonly options: ResolvedOpenRouterApiOptions,
    private readonly models: readonly OpenRouterApiModel[],
    private readonly responses: ResponseCoordinator,
  ) {}

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const startedAt = Date.now();
    const requestId = `req-${randomUUID()}`;
    const method = request.method ?? "UNKNOWN";
    const path = new URL(request.url ?? "/", "http://agent-os.local").pathname;

    response.setHeader("x-request-id", requestId);
    this.log({ type: "request.started", requestId, method, path });
    try {
      applyCors(request, response, this.options.corsOrigins);
      await this.route(request, response, listener, path);
    } catch (error) {
      this.log({
        type: "request.failed",
        requestId,
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      writeError(response, error);
    } finally {
      this.log({
        type: "request.completed",
        requestId,
        method,
        path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private async route(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
    path: string,
  ): Promise<void> {
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && path === "/health") {
      writeJson(response, 200, {
        status: "ok",
        service: "agent-os-openrouter-api",
      });
      return;
    }

    authorize(request, this.options.apiKey);
    if (request.method === "GET" && MODEL_PATHS.has(path)) {
      writeJson(response, 200, { object: "list", data: this.modelList() });
      return;
    }
    if (request.method === "GET" && this.isModelDetailPath(path)) {
      this.writeModelDetail(response, path);
      return;
    }
    if (request.method === "POST" && RESPONSES_PATHS.has(path)) {
      await this.completeResponses(request, response, listener);
      return;
    }
    if (
      request.method !== "POST" ||
      !this.options.chatCompletionsPaths.includes(path)
    ) {
      throw new HttpError(404, "Not found", "not_found");
    }

    await this.completeChat(request, response, listener);
  }

  private async completeResponses(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const body = parseResponsesRequest(
      await readJsonBody(request, this.options.maxBodyBytes),
    );
    const completionId = `resp_${randomUUID()}`;
    const context = createResponseContext(body, response, completionId, "responses");
    const message = this.createResponsesMessage(request, body, completionId);
    response.setHeader("x-request-id", completionId);

    await this.responses.run(context, message, listener);
    if (context.responded || response.writableEnded) return;

    const output = context.outputs.at(-1);
    if (!output) {
      throw new HttpError(500, "Agent OS did not write a response", "missing_output");
    }
    context.responded = true;
    if (body.stream === true) {
      await writeResponsesSse(context, toAsyncIterable(output.chunks));
      return;
    }
    writeResponsesCompletion(context, output.chunks.join(""));
  }

  private async completeChat(
    request: IncomingMessage,
    response: ServerResponse,
    listener: InputListener,
  ): Promise<void> {
    const body = parseChatCompletionRequest(
      await readJsonBody(request, this.options.maxBodyBytes),
      this.options.openClawCompatibility ? "openclaw" : undefined,
    );
    const completionId = `chatcmpl-${randomUUID()}`;
    const context = createResponseContext(
      body,
      response,
      completionId,
      "chat.completions",
    );
    const message = this.createMessage(request, body, completionId);
    response.setHeader("x-request-id", completionId);

    await this.responses.run(context, message, listener);
    if (context.responded || response.writableEnded) return;

    const output = context.outputs.at(-1);
    if (!output) {
      throw new HttpError(
        500,
        "Agent OS did not write a response to the openrouter-api output",
        "missing_output",
      );
    }

    context.responded = true;
    if (body.stream === true) {
      await writeSse(context, toAsyncIterable(output.chunks));
      return;
    }
    writeCompletion(context, output.chunks.join(""));
  }

  private createMessage(
    request: IncomingMessage,
    body: ChatCompletionRequest,
    completionId: string,
  ): InputMessage {
    const sessionId =
      normalizeText(body.session_id) ??
      normalizeText(firstHeader(request, "x-openclaw-session-key")) ??
      normalizeText(body.user) ??
      normalizeText(firstHeader(request, "x-session-id")) ??
      this.options.sessionId ??
      `openrouter-${randomUUID()}`;
    return {
      id: `input-${randomUUID()}`,
      channel: "openrouter-api",
      sessionId,
      userId: normalizeText(body.user) ?? normalizeText(this.options.userId),
      text: renderConversation(body.messages),
      createdAt: new Date(),
      metadata: {
        originalText: lastUserMessageText(body.messages),
        preferredOutputChannel: "openrouter-api",
        requestId: completionId,
        transport: "openrouter-api",
        model: body.model,
        modelOverride: normalizeText(firstHeader(request, "x-openclaw-model")),
        agentId: normalizeText(firstHeader(request, "x-openclaw-agent-id")),
        messageChannel: normalizeText(
          firstHeader(request, "x-openclaw-message-channel"),
        ),
        stream: body.stream === true,
        remoteAddress: request.socket.remoteAddress,
      },
    };
  }

  private createResponsesMessage(
    request: IncomingMessage,
    body: ResponsesRequest,
    completionId: string,
  ): InputMessage {
    const sessionId =
      normalizeText(firstHeader(request, "x-openclaw-session-key")) ??
      normalizeText(body.user) ??
      normalizeText(firstHeader(request, "x-session-id")) ??
      this.options.sessionId ??
      `openresponses-${randomUUID()}`;
    return {
      id: `input-${randomUUID()}`,
      channel: "openrouter-api",
      sessionId,
      userId: normalizeText(body.user) ?? normalizeText(this.options.userId),
      text: renderResponsesInput(body),
      createdAt: new Date(),
      metadata: {
        preferredOutputChannel: "openrouter-api",
        requestId: completionId,
        transport: "openresponses-api",
        model: body.model,
        modelOverride: normalizeText(firstHeader(request, "x-openclaw-model")),
        agentId: normalizeText(firstHeader(request, "x-openclaw-agent-id")),
        messageChannel: normalizeText(
          firstHeader(request, "x-openclaw-message-channel"),
        ),
        previousResponseId: normalizeText(body.previous_response_id),
        stream: body.stream === true,
        remoteAddress: request.socket.remoteAddress,
      },
    };
  }

  private isModelDetailPath(path: string): boolean {
    return path.startsWith("/v1/models/") || path.startsWith("/api/v1/models/");
  }

  private writeModelDetail(response: ServerResponse, path: string): void {
    const prefix = path.startsWith("/api/") ? "/api/v1/models/" : "/v1/models/";
    let id: string;
    try {
      id = decodeURIComponent(path.slice(prefix.length));
    } catch {
      throw new HttpError(400, "Invalid model id encoding", "invalid_request_error");
    }
    const model = this.modelList().find((candidate) => candidate.id === id);
    if (!model) {
      throw new HttpError(404, `Model '${id}' not found.`, "invalid_request_error");
    }
    writeJson(response, 200, model);
  }

  private modelList() {
    return this.models.map((model) => ({
      id: model.id,
      object: "model",
      created: 0,
      owned_by: this.options.openClawCompatibility ? "openclaw" : "agent-os",
      ...(this.options.openClawCompatibility ? { permission: [] } : {}),
      name: model.name,
      description: model.description,
      context_length: model.contextLength,
    }));
  }

  private log(event: OpenRouterApiLogEvent): void {
    safeLog(this.options.onLog, event);
  }
}

function createResponseContext(
  request: ChatCompletionRequest | ResponsesRequest,
  response: ServerResponse,
  completionId: string,
  format: ResponseContext["format"],
): ResponseContext {
  return {
    request,
    response,
    completionId,
    created: Math.floor(Date.now() / 1000),
    outputs: [],
    responded: false,
    format,
  };
}
