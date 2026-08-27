import type { ResponseContext } from "./types.js";
import { writeJson } from "./http-response.js";

export function writeCompletion(
  context: ResponseContext,
  content: string,
): void {
  writeJson(context.response, 200, {
    id: context.completionId,
    object: "chat.completion",
    created: context.created,
    model: context.request.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  });
}

export async function writeSse(
  context: ResponseContext,
  content: AsyncIterable<string>,
): Promise<void> {
  const { response } = context;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeSseData(context, chunk({ role: "assistant" }, null));

  for await (const value of content) {
    const parts = splitStreamingChunk(value);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) continue;
      writeSseData(context, chunk({ content: part }, null));
      if (index < parts.length - 1) await yieldToEventLoop();
    }
  }

  writeSseData(context, chunk({}, "stop"));
  response.write("data: [DONE]\n\n");
  response.end();
}

export function splitStreamingChunk(
  value: string,
  maxLength = 32,
): string[] {
  if (value.length <= maxLength) return value ? [value] : [];

  const parts: string[] = [];
  let current = "";
  for (const token of value.match(/\S+\s*|\s+/gu) ?? [value]) {
    if (current && current.length + token.length > maxLength) {
      parts.push(current);
      current = "";
    }
    if (token.length <= maxLength) {
      current += token;
      continue;
    }

    const characters = Array.from(token);
    while (characters.length > maxLength) {
      parts.push(characters.splice(0, maxLength).join(""));
    }
    current = characters.join("");
  }
  if (current) parts.push(current);
  return parts;
}

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return { choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

function writeSseData(
  context: ResponseContext,
  value: Record<string, unknown>,
): void {
  context.response.write(
    `data: ${JSON.stringify({
      id: context.completionId,
      object: "chat.completion.chunk",
      created: context.created,
      model: context.request.model,
      ...value,
    })}\n\n`,
  );
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
