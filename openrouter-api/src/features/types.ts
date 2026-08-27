import type { ServerResponse } from "node:http";

export interface OpenRouterApiModel {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
}

export type OpenRouterApiLogEvent =
  | { type: "listening"; url: string }
  | {
      type: "request.started";
      requestId: string;
      method: string;
      path: string;
    }
  | {
      type: "request.completed";
      requestId: string;
      method: string;
      path: string;
      status: number;
      durationMs: number;
    }
  | {
      type: "request.failed";
      requestId: string;
      method: string;
      path: string;
      error: string;
    }
  | { type: "stopped" };

export interface OpenRouterApiInputOptions {
  hostname?: string;
  port?: number;
  apiKey?: string;
  sessionId?: string;
  /** Stable identity used when a client does not send the OpenAI `user` field. */
  userId?: string;
  models?: string | readonly (string | OpenRouterApiModel)[];
  corsOrigins?: "*" | string | readonly string[] | false;
  maxBodyBytes?: number;
  chatCompletionsPaths?: readonly string[];
  /** Enable OpenClaw model aliases, headers, and compatible HTTP response shapes. */
  openClawCompatibility?: boolean;
  /** Backend model metadata advertised to OpenClaw WebSocket chat clients. */
  backendModel?: string;
  backendProvider?: string;
  /** Logs lifecycle events by default unless `onLog` is provided. */
  log?: boolean;
  onLog?: (event: OpenRouterApiLogEvent) => void;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  stream?: boolean;
  user?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface ResponsesRequest {
  model: string;
  input: unknown;
  instructions?: string;
  stream?: boolean;
  user?: string;
  previous_response_id?: string;
  [key: string]: unknown;
}

export type CompatibleApiRequest = ChatCompletionRequest | ResponsesRequest;

export interface BufferedOutput {
  chunks: string[];
}

export interface ResponseContext {
  request: CompatibleApiRequest;
  response: ServerResponse;
  completionId: string;
  created: number;
  outputs: BufferedOutput[];
  responded: boolean;
  format: "chat.completions" | "responses";
}

export interface ResolvedOpenRouterApiOptions
  extends Omit<
    OpenRouterApiInputOptions,
    "hostname" | "port" | "maxBodyBytes" | "chatCompletionsPaths" | "models" | "corsOrigins"
  > {
  hostname: string;
  port: number;
  maxBodyBytes: number;
  chatCompletionsPaths: readonly string[];
  corsOrigins?: "*" | readonly string[] | false;
}
