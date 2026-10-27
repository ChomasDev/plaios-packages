import { AsyncLocalStorage } from "node:async_hooks";
import type { InputListener, InputMessage, OutputContent } from "@plaios/core/domain";
import { writeSse } from "./completion-response.js";
import { writeResponsesSse } from "./responses-response.js";
import type { ResponseContext } from "./types.js";

export class ResponseCoordinator {
  private readonly contexts = new AsyncLocalStorage<ResponseContext>();

  async run(
    context: ResponseContext,
    message: InputMessage,
    listener: InputListener,
  ): Promise<void> {
    await this.contexts.run(context, () => listener(message));
  }

  get active(): boolean {
    return this.contexts.getStore() !== undefined;
  }

  async write(content: OutputContent): Promise<void> {
    const context = this.contexts.getStore();
    if (!context) {
      throw new Error(
        "OpenRouterApiInput.write must run inside an active HTTP request",
      );
    }
    if (context.responded) return;
    if (typeof content === "string") {
      context.outputs.push({ chunks: [content] });
      return;
    }
    if (context.request.stream === true) {
      context.responded = true;
      if (context.format === "responses") {
        await writeResponsesSse(context, content);
      } else {
        await writeSse(context, content);
      }
      return;
    }

    const chunks: string[] = [];
    for await (const chunk of content) chunks.push(chunk);
    context.outputs.push({ chunks });
  }
}
