import type { ResponseContext } from "./types.js";
import { writeJson } from "./http-response.js";

export function writeResponsesCompletion(
  context: ResponseContext,
  content: string,
): void {
  writeJson(context.response, 200, responseResource(context, content, "completed"));
}

export async function writeResponsesSse(
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

  const initial = responseResource(context, "", "in_progress");
  event(response, { type: "response.created", response: initial });
  event(response, { type: "response.in_progress", response: initial });

  let text = "";
  for await (const chunk of content) {
    if (!chunk) continue;
    text += chunk;
    event(response, {
      type: "response.output_text.delta",
      item_id: outputItemId(context),
      output_index: 0,
      content_index: 0,
      delta: chunk,
    });
  }

  event(response, {
    type: "response.output_text.done",
    item_id: outputItemId(context),
    output_index: 0,
    content_index: 0,
    text,
  });
  const completed = responseResource(context, text, "completed");
  event(response, { type: "response.completed", response: completed });
  response.write("data: [DONE]\n\n");
  response.end();
}

function responseResource(
  context: ResponseContext,
  text: string,
  status: "in_progress" | "completed",
) {
  return {
    id: context.completionId,
    object: "response",
    created_at: context.created,
    status,
    model: context.request.model,
    output: status === "completed" ? [{
      type: "message",
      id: outputItemId(context),
      role: "assistant",
      content: [{ type: "output_text", text }],
      phase: "final_answer",
      status: "completed",
    }] : [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

function outputItemId(context: ResponseContext): string {
  return `msg_${context.completionId.replace(/^resp_/, "")}`;
}

function event(
  response: ResponseContext["response"],
  value: Record<string, unknown>,
): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}
