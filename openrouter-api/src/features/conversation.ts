import { HttpError } from "./http-error.js";
import type { ChatCompletionMessage, ResponsesRequest } from "./types.js";
import { isRecord, normalizeText, serialize } from "./utils.js";

export function renderConversation(
  messages: readonly ChatCompletionMessage[],
): string {
  const hasContent = messages.some(
    (message) =>
      renderContent(message.content).trim() || message.tool_calls !== undefined,
  );
  if (!hasContent) {
    throw new HttpError(
      400,
      "At least one message must contain text or tool calls",
      "invalid_request",
    );
  }

  const rendered = messages.map(renderMessage).join("\n\n");
  return `Conversation supplied through an OpenRouter-compatible API:\n\n${rendered}`;
}

export function lastUserMessageText(
  messages: readonly ChatCompletionMessage[],
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const content = renderContent(message.content).trim();
    if (content) return lastUserUtterance(content);
  }
  return undefined;
}

export function lastUserUtterance(text: string): string {
  const turns = parseTranscriptTurns(text);
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  return lastUser?.content ?? text.trim();
}

export function parseTranscriptTurns(
  text: string,
): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const trimmed = text.trim();
  if (!/(?:^|\n)(?:USER|ASSISTANT|SYSTEM):/i.test(trimmed)) return [];
  return trimmed
    .split(/\n(?=(?:USER|ASSISTANT|SYSTEM):)/i)
    .flatMap((block) => {
      const match = block.match(/^(USER|ASSISTANT|SYSTEM):\s*([\s\S]*)$/i);
      if (!match) return [];
      const content = match[2]!.trim();
      if (!content) return [];
      const label = match[1]!.toLowerCase();
      const role = label === "assistant" ? "assistant" : label === "system" ? "system" : "user";
      return [{ role, content }];
    });
}

export function renderResponsesInput(request: ResponsesRequest): string {
  const rendered = renderResponseValue(request.input).trim();
  if (!rendered) {
    throw new HttpError(400, "The input field must contain content", "invalid_request");
  }

  return [
    "Conversation supplied through an OpenResponses-compatible API:",
    request.instructions ? `INSTRUCTIONS:\n${request.instructions}` : undefined,
    rendered,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    return content == null ? "" : serialize(content);
  }
  return content.map(renderPart).join("\n");
}

function renderMessage(message: ChatCompletionMessage): string {
  const labels = [message.role.toUpperCase()];
  if (message.name) labels.push(` (${message.name})`);
  if (message.tool_call_id) {
    labels.push(` [tool_call_id=${message.tool_call_id}]`);
  }

  const sections = [`${labels.join("")}:`, renderContent(message.content)];
  if (message.tool_calls !== undefined) {
    sections.push(`Tool calls: ${serialize(message.tool_calls)}`);
  }
  return sections.filter(Boolean).join("\n");
}

function renderPart(part: unknown): string {
  if (!isRecord(part)) return serialize(part);
  if (
    (part.type === "text" || part.type === "input_text") &&
    typeof part.text === "string"
  ) {
    return part.text;
  }
  if (part.type !== "image_url") return serialize(part);

  const url = imageUrl(part.image_url);
  return url ? `[Image: ${url}]` : "[Image]";
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return isRecord(value) ? normalizeText(value.url) : undefined;
}

function renderResponseValue(value: unknown): string {
  if (typeof value === "string") return `USER:\n${value}`;
  if (!Array.isArray(value)) return value == null ? "" : serialize(value);

  return value.map((item) => {
    if (!isRecord(item)) return serialize(item);
    if (item.type === "message") {
      const role = normalizeText(item.role)?.toUpperCase() ?? "USER";
      return `${role}:\n${renderContent(item.content)}`;
    }
    if (item.type === "function_call_output") {
      return `TOOL [call_id=${normalizeText(item.call_id) ?? "unknown"}]:\n${renderContent(item.output)}`;
    }
    return renderPart(item);
  }).join("\n\n");
}
