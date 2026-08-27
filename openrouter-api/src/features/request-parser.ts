import type { IncomingMessage } from "node:http";
import { HttpError } from "./http-error.js";
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  ResponsesRequest,
} from "./types.js";
import { isRecord, normalizeText } from "./utils.js";

const ROLES = new Set(["system", "user", "assistant", "tool"]);

export function parseChatCompletionRequest(
  value: unknown,
  defaultModel?: string,
): ChatCompletionRequest {
  if (!isRecord(value)) {
    throw invalidRequest("Request body must be a JSON object");
  }

  const model = normalizeText(value.model) ?? defaultModel;
  if (!model) throw invalidRequest("The model field is required");
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    throw invalidRequest("The messages field must be a non-empty array");
  }

  return {
    ...value,
    model,
    messages: value.messages.map(parseMessage),
    stream: value.stream === true,
    user: normalizeText(value.user),
    session_id: normalizeText(value.session_id),
  };
}

export function parseResponsesRequest(value: unknown): ResponsesRequest {
  if (!isRecord(value)) {
    throw invalidRequest("Request body must be a JSON object");
  }
  if (value.input === undefined) {
    throw invalidRequest("The input field is required");
  }

  return {
    ...value,
    model: normalizeText(value.model) ?? "openclaw",
    input: value.input,
    instructions: normalizeText(value.instructions),
    stream: value.stream === true,
    user: normalizeText(value.user),
    previous_response_id: normalizeText(value.previous_response_id),
  };
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > maxBodyBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }

  if (tooLarge) {
    throw new HttpError(
      413,
      `Request body exceeds ${maxBodyBytes} bytes`,
      "request_too_large",
    );
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "Request body must contain valid JSON",
      "invalid_json",
    );
  }
}

function parseMessage(value: unknown, index: number): ChatCompletionMessage {
  if (!isRecord(value)) {
    throw invalidRequest(`messages[${index}] must be an object`);
  }
  if (typeof value.role !== "string" || !ROLES.has(value.role)) {
    throw invalidRequest(`messages[${index}].role is invalid`);
  }

  return {
    role: value.role as ChatCompletionMessage["role"],
    content: value.content,
    name: normalizeText(value.name),
    tool_call_id: normalizeText(value.tool_call_id),
    tool_calls: value.tool_calls,
  };
}

function invalidRequest(message: string): HttpError {
  return new HttpError(400, message, "invalid_request");
}
