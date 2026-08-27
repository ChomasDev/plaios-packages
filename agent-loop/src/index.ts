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
