import { randomUUID } from "node:crypto";
import type {
  AgentLoop,
  AgentLoopEvent,
  AgentLoopOptions,
  AIInput,
  AIExecutableFunctionDefinition,
  AIProcessResult,
  AIProvider,
  Capability,
  CapabilityDiscovery,
  InputMessage,
} from "@agent-os/core/domain";

export interface DefaultAgentLoopOptions {
  model: AIProvider;
  capabilityDiscovery: CapabilityDiscovery;
  maxCapabilities?: number;
  maxSteps?: number;
  instructions?: string;
  alwaysCapabilityIds?: readonly string[];
}

const defaultInstructions = [
  "You are Agent OS.",
  "Use an available capability whenever it can directly answer the request.",
  "For local filesystem or runtime questions, call the relevant capability instead of asking the user to run a command.",
  "If the initial memory context is incomplete, call memory_retrieval with focused follow-up queries; call it more than once when different angles are needed.",
  "After receiving capability results, provide a concise final answer.",
].join(" ");

export class DefaultAgentLoop implements AgentLoop {
  private readonly model: AIProvider;
  private readonly capabilityDiscovery: CapabilityDiscovery;
  private readonly maxCapabilities: number;
  private readonly maxSteps: number;
  private readonly instructions: string;
  private readonly alwaysCapabilityIds: readonly string[];

  constructor(options: DefaultAgentLoopOptions) {
    this.model = options.model;
    this.capabilityDiscovery = options.capabilityDiscovery;
    this.maxCapabilities = Math.max(1, options.maxCapabilities ?? 50);
    this.maxSteps = Math.max(1, options.maxSteps ?? 100);
    this.instructions = options.instructions ?? defaultInstructions;
    this.alwaysCapabilityIds = options.alwaysCapabilityIds ?? ["memory.retrieval"];
  }

  async run(
    message: InputMessage,
    options: AgentLoopOptions,
  ): Promise<AIProcessResult> {
    const runId = `run-${randomUUID()}`;

    await emit(options, {
      type: "discovery.started",
      runId,
      at: new Date(),
      query:
        typeof message.metadata?.originalText === "string"
          ? message.metadata.originalText
          : message.text,
    });

    // Orchestrator owns discovery/selection; the loop only loads by ID.
    if (options.bypassModel) {
      const confirmation = protocolConfirmation(message, options);
      if (confirmation) return { type: "text", text: confirmation };
      return this.runDirect(runId, message, options);
    }

    const capabilities = await this.loadCapabilities([
      ...this.alwaysCapabilityIds,
      ...(options.capabilityIds ?? []),
    ]);
    const modelInput = toModelInput(message);

    await emit(options, {
      type: "discovery.completed",
      runId,
      at: new Date(),
      capabilities: capabilities.map(
        (capability) => capability.manifest.name,
      ),
    });

    if (capabilities.length === 0) {
      await emit(options, {
        type: "model.started",
        runId,
        at: new Date(),
        capabilities: [],
      });

      return this.model.processInput(modelInput, {
        stream: options.stream,
        signal: options.signal,
        instructions: this.instructions,
      });
    }

    const functions = capabilities.map(
      (capability): AIExecutableFunctionDefinition => ({
        name: capability.manifest.name,
        description: capability.manifest.description,
        inputSchema: capability.manifest.inputSchema,
        strict: true,
        execute: async (arguments_, context) => {
          await emit(options, {
            type: "capability.started",
            runId,
            at: new Date(),
            callId: context.callId,
            capability: capability.manifest.name,
            arguments: arguments_,
          });

          try {
            const result = await capability.execute(arguments_, {
              runId,
              callId: context.callId,
              sessionId: message.sessionId,
              userId: message.userId,
              startedAt: new Date(),
              signal: context.signal ?? options.signal,
              metadata: {
                inputMessageId: message.id,
                channel: message.channel,
                originalText: message.metadata?.originalText,
              },
            });

            await emit(options, {
              type: "capability.completed",
              runId,
              at: new Date(),
              callId: context.callId,
              capability: capability.manifest.name,
              result,
            });

            return result;
          } catch (error) {
            await emit(options, {
              type: "capability.failed",
              runId,
              at: new Date(),
              callId: context.callId,
              capability: capability.manifest.name,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        },
      }),
    );

    await emit(options, {
      type: "model.started",
      runId,
      at: new Date(),
      capabilities: functions.map((definition) => definition.name),
    });

    return this.model.processWithFunctions(modelInput, functions, {
      stream: options.stream,
      signal: options.signal,
      instructions: this.instructions,
      maxSteps: this.maxSteps,
    });
  }

  private async runDirect(
    runId: string,
    message: InputMessage,
    options: AgentLoopOptions,
  ): Promise<AIProcessResult> {
    const capabilities = await this.loadCapabilities(options.capabilityIds ?? []);
    const input = directCapabilityInput(message);

    await emit(options, {
      type: "discovery.completed",
      runId,
      at: new Date(),
      capabilities: capabilities.map((capability) => capability.manifest.name),
    });

    const summaries: string[] = [];
    const images: Array<{ path: string; mediaType: string }> = [];
    for (const capability of capabilities) {
      const callId = `direct-${capability.manifest.id}`;
      await emit(options, {
        type: "capability.started",
        runId,
        at: new Date(),
        callId,
        capability: capability.manifest.name,
        arguments: input,
      });
      try {
        const result = await capability.execute(
          input,
          {
            runId,
            callId,
            sessionId: message.sessionId,
            userId: message.userId,
            startedAt: new Date(),
            signal: options.signal,
            metadata: {
              inputMessageId: message.id,
              channel: message.channel,
              originalText: message.metadata?.originalText,
              bypassModel: true,
            },
          },
        );
        await emit(options, {
          type: "capability.completed",
          runId,
          at: new Date(),
          callId,
          capability: capability.manifest.name,
          result,
        });
        summaries.push(summarizeCapabilityResult(result));
        const image = imageFromCapabilityResult(result);
        if (image) images.push(image);
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        await emit(options, {
          type: "capability.failed",
          runId,
          at: new Date(),
          callId,
          capability: capability.manifest.name,
          error: messageText,
        });
        summaries.push(messageText);
      }
    }

    const text = summaries.filter(Boolean).join("\n") || "Done.";
    if (images.length > 0 && wantsVisualReport(message)) {
      await emit(options, {
        type: "model.started",
        runId,
        at: new Date(),
        capabilities: [],
      });
      return this.model.processInput(
        {
          text: visualReportPrompt(message, text),
          images,
        },
        {
          stream: options.stream,
          signal: options.signal,
          instructions: this.instructions,
        },
      );
    }

    return { type: "text", text };
  }

  private async loadCapabilities(
    capabilityIds: readonly string[],
  ): Promise<Capability[]> {
    const capabilities = await Promise.all(
      [...new Set(capabilityIds)]
        .slice(0, this.maxCapabilities)
        .map((id) => this.capabilityDiscovery.get(id)),
    );

    return capabilities.filter(
      (capability): capability is Capability => capability !== undefined,
    );
  }
}

function summarizeCapabilityResult(result: { success: boolean; data?: unknown; error?: { message?: string } }): string {
  if (!result.success) return result.error?.message || "The capability failed.";
  if (result.data && typeof result.data === "object" && "summary" in result.data) {
    const summary = (result.data as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) return summary;
  }
  if (typeof result.data === "string") return result.data;
  return JSON.stringify(result.data ?? {}, null, 2);
}

function directCapabilityInput(message: InputMessage): { text: string; history?: Array<{ role: string; content: string }> } {
  const text =
    typeof message.metadata?.originalText === "string" && message.metadata.originalText.trim()
      ? message.metadata.originalText
      : message.text;
  const history = compactHistory(message.metadata?.conversationHistory);
  return history.length > 0 ? { text, history } : { text };
}

function compactHistory(value: unknown): Array<{ role: string; content: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const role = "role" in entry && typeof entry.role === "string" ? entry.role : "";
    const content = "content" in entry && typeof entry.content === "string" ? entry.content : "";
    return role && content ? [{ role, content }] : [];
  });
}

function protocolConfirmation(
  message: InputMessage,
  options: AgentLoopOptions,
): string | undefined {
  if ((options.capabilityIds?.length ?? 0) > 0) return undefined;
  const text = message.metadata?.protocolConfirmation;
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
}

function imageFromCapabilityResult(result: {
  success: boolean;
  data?: unknown;
}): { path: string; mediaType: string } | undefined {
  if (!result.success || !result.data || typeof result.data !== "object") return undefined;
  const path = "localPath" in result.data && typeof result.data.localPath === "string"
    ? result.data.localPath
    : "";
  if (!path || !/\.(png|jpe?g|webp|gif)$/i.test(path)) return undefined;
  return { path, mediaType: mediaTypeForPath(path) };
}

function mediaTypeForPath(path: string): string {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  return "image/png";
}

function wantsVisualReport(message: InputMessage): boolean {
  const text =
    typeof message.metadata?.originalText === "string" && message.metadata.originalText.trim()
      ? message.metadata.originalText
      : message.text;
  return /\b(telegram|cosa vedi|che vedi|descrivi|descrizione|scrivimi|scrivermi|mandami|mandarmi|dimmi)\b/i.test(
    text,
  );
}

function visualReportPrompt(message: InputMessage, summary: string): string {
  const text =
    typeof message.metadata?.originalText === "string" && message.metadata.originalText.trim()
      ? message.metadata.originalText
      : message.text;
  return [
    `The user said: "${text}"`,
    summary,
    "A screenshot was captured. Describe clearly what you see on the screen, in the user's language.",
    "Be specific about apps, windows, text, and layout. Do not mention file paths unless useful.",
  ].join("\n");
}

function toModelInput(message: InputMessage): AIInput {
  const images = (message.attachments ?? [])
    .filter((attachment) => attachment.type === "image")
    .map(({ path, mediaType }) => ({ path, mediaType }));
  return images.length > 0 ? { text: message.text, images } : message.text;
}

async function emit(
  options: AgentLoopOptions,
  event: AgentLoopEvent,
): Promise<void> {
  await options.onEvent?.(event);
}
