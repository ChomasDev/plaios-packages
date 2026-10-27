import type {
  AIFunctionDefinition,
  AIProvider,
  CapabilityDiscovery,
  CapabilityManifest,
  InputMessage,
  MemoryProposal,
  OrchestrationDecision,
  Orchestrator,
  OrchestratorOptions,
  OutputInterface,
} from "@agent-os/core";
import {
  createMemoryProposalSchema,
  sanitizeMemoryProposals,
  type ModelMemoryProposal,
} from "./memory-routing.js";

export interface DefaultOrchestratorOptions {
  model: AIProvider;
  capabilityDiscovery: CapabilityDiscovery;
  minCapabilities?: number;
  maxCapabilities?: number;
  instructions?: string;
  fastPath?: boolean;
}
interface ModelDecision {
  capabilityIds: string[];
  outputChannel: string;
  additionalOutputs: ModelAdditionalOutput[];
  memoryProposals: ModelMemoryProposal[];
  reason: string;
}
interface ModelAdditionalOutput {
  outputChannel: string;
  content: "response" | "text";
  text: string;
}
const defaultInstructions = [
  "Route one Agent OS message by prioritizing capabilities that materially help; a configured baseline capability set will remain available to the agent even when routing selects fewer tools.",
  "Use recent conversation history only to resolve follow-ups and unfinished tool requests.",
  "Prefer the input channel unless the request asks for another destination; use additional outputs only for explicit multi-destination delivery.",
  "Propose memory only for durable facts, preferences, relationships, or ongoing goals explicitly stated in the current user text.",
  "For each proposed memory, record the fact date only when the user supplied one; resolve relative dates against the source message date.",
  "Never store guesses, temporary requests, credentials, or secrets.",
].join(" ");

export class DefaultOrchestrator implements Orchestrator {
  private readonly model: AIProvider;
  private readonly capabilityDiscovery: CapabilityDiscovery;
  private readonly minCapabilities: number;
  private readonly maxCapabilities: number;
  private readonly instructions: string;
  private readonly fastPath: boolean;
  constructor(options: DefaultOrchestratorOptions) {
    if (!options.model) throw new Error("DefaultOrchestrator requires an AI provider");
    if (!options.capabilityDiscovery)
      throw new Error("DefaultOrchestrator requires capability discovery");
    this.model = options.model;
    this.capabilityDiscovery = options.capabilityDiscovery;
    this.maxCapabilities = Math.max(0, options.maxCapabilities ?? 50);
    this.minCapabilities = Math.min(
      this.maxCapabilities,
      Math.max(0, options.minCapabilities ?? 30),
    );
    this.instructions = options.instructions ?? defaultInstructions;
    this.fastPath = options.fastPath ?? false;
  }
  microfrontendData() {
    return {
      modelProvider: this.model.provider,
      model: this.model.model,
      discovery: this.capabilityDiscovery.constructor.name,
      minCapabilities: this.minCapabilities,
      maxCapabilities: this.maxCapabilities,
      fastPath: this.fastPath,
      instructionsMode:
        this.instructions === defaultInstructions ? ("default" as const) : ("custom" as const),
    };
  }

  async orchestrate(
    message: InputMessage,
    outputs: readonly OutputInterface[],
    options: OrchestratorOptions = {},
  ): Promise<OrchestrationDecision> {
    if (outputs.length === 0) throw new Error("DefaultOrchestrator requires at least one output");
    const channels = unique(outputs.map(({ channel }) => channel));
    const fallbackOutput = selectFallbackOutput(message, outputs);
    const explicitOutput = selectExplicitDeliveryOutput(message, outputs);
    if (explicitOutput && explicitOutput.channel !== fallbackOutput.channel)
      return {
        capabilityIds: [],
        outputChannel: explicitOutput.channel,
        additionalOutputs: [
          {
            outputChannel: fallbackOutput.channel,
            content: "text",
            text: deliveryAcknowledgement(explicitOutput.channel),
          },
        ],
        memoryProposals: [],
        deferMemoryProposal: true,
        reason: `Explicit delivery request for ${explicitOutput.channel}.`,
      };
    const candidates = await this.capabilityDiscovery.discover();
    if (this.fastPath && channels.length === 1) {
      const local = await this.capabilityDiscovery.discover({
        text: currentUserText(message),
        limit: this.maxCapabilities,
      });
      return {
        capabilityIds: baselineCapabilityIds(
          local.map(({ id }) => id),
          candidates,
          this.minCapabilities,
          this.maxCapabilities,
        ),
        outputChannel: fallbackOutput.channel,
        additionalOutputs: [],
        memoryProposals: [],
        deferMemoryProposal: true,
        reason:
          "Local single-output routing with dynamically discovered and baseline capabilities.",
      };
    }
    try {
      const result = await this.model.functionCall<ModelDecision>(
        createRoutingPrompt(message, candidates, outputs),
        createDecisionFunction(candidates, channels, this.maxCapabilities),
        { signal: options.signal, instructions: this.instructions },
      );
      const allowed = new Set(candidates.map(({ id }) => id));
      const outputChannel = channels.includes(result.arguments.outputChannel)
        ? result.arguments.outputChannel
        : fallbackOutput.channel;
      return {
        capabilityIds: baselineCapabilityIds(
          unique(result.arguments.capabilityIds).filter((id) => allowed.has(id)),
          candidates,
          this.minCapabilities,
          this.maxCapabilities,
        ),
        outputChannel,
        additionalOutputs: sanitizeAdditionalOutputs(
          result.arguments.additionalOutputs,
          channels,
          outputChannel,
        ),
        memoryProposals: sanitizeMemoryProposals(result.arguments.memoryProposals),
        reason: result.arguments.reason,
      };
    } catch (error) {
      const fallback = await this.capabilityDiscovery.discover({
        text: message.text,
        limit: this.maxCapabilities,
      });
      return {
        capabilityIds: fallback.map(({ id }) => id),
        outputChannel: fallbackOutput.channel,
        additionalOutputs: [],
        memoryProposals: [],
        reason: `Model routing failed; used deterministic fallback: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async proposeMemory(
    message: InputMessage,
    options: OrchestratorOptions = {},
  ): Promise<readonly MemoryProposal[]> {
    const userText = currentUserText(message);
    if (!shouldProposeMemory(userText)) return [];
    try {
      const result = await this.model.functionCall<{ memoryProposals: ModelMemoryProposal[] }>(
        JSON.stringify({
          currentUserText: userText,
          sourceMessageDate: message.createdAt.toISOString(),
        }),
        {
          name: "extract_durable_memory",
          description: "Extracts durable user memories from one user message.",
          strict: true,
          inputSchema: {
            type: "object",
            properties: { memoryProposals: createMemoryProposalSchema() },
            required: ["memoryProposals"],
            additionalProperties: false,
          },
        },
        {
          signal: options.signal,
          instructions:
            "Extract only explicit durable facts, preferences, relationships, or ongoing goals. Set factDate only when the user supplies a date, resolving relative dates against sourceMessageDate. Never store guesses, temporary requests, credentials, or secrets.",
        },
      );
      return sanitizeMemoryProposals(result.arguments.memoryProposals);
    } catch {
      return [];
    }
  }
}

function createDecisionFunction(
  capabilities: readonly CapabilityManifest[],
  channels: readonly string[],
  maxCapabilities: number,
): AIFunctionDefinition<ModelDecision> {
  return {
    name: "route_agent_message",
    description: "Selects capability IDs and output channels for an Agent OS message.",
    strict: true,
    inputSchema: {
      type: "object",
      properties: {
        capabilityIds: {
          type: "array",
          items: capabilities.length
            ? { type: "string", enum: capabilities.map(({ id }) => id) }
            : { type: "string" },
          maxItems: maxCapabilities,
        },
        outputChannel: { type: "string", enum: channels },
        additionalOutputs: {
          type: "array",
          maxItems: Math.max(0, channels.length - 1),
          items: {
            type: "object",
            properties: {
              outputChannel: { type: "string", enum: channels },
              content: { type: "string", enum: ["response", "text"] },
              text: { type: "string" },
            },
            required: ["outputChannel", "content", "text"],
            additionalProperties: false,
          },
        },
        memoryProposals: createMemoryProposalSchema(),
        reason: { type: "string" },
      },
      required: [
        "capabilityIds",
        "outputChannel",
        "additionalOutputs",
        "memoryProposals",
        "reason",
      ],
      additionalProperties: false,
    },
  };
}

function baselineCapabilityIds(
  selected: readonly string[],
  candidates: readonly CapabilityManifest[],
  minimum: number,
  maximum: number,
): string[] {
  const baseline = unique([...selected, ...candidates.map(({ id }) => id)]);
  const selectedCount = Math.max(minimum, selected.length);
  return baseline.slice(0, Math.min(maximum, selectedCount));
}

function createRoutingPrompt(
  message: InputMessage,
  capabilities: readonly CapabilityManifest[],
  outputs: readonly OutputInterface[],
): string {
  const history = Array.isArray(message.metadata?.conversationHistory)
    ? message.metadata.conversationHistory
        .slice(-6)
        .map((entry) =>
          isRecord(entry)
            ? {
                role: typeof entry.role === "string" ? entry.role : "message",
                content: truncateText(entry.content, 1_000),
              }
            : entry,
        )
    : [];
  return JSON.stringify(
    {
      message: {
        channel: message.channel,
        sessionId: message.sessionId,
        sourceMessageDate: message.createdAt.toISOString(),
        text: currentUserText(message),
        conversationHistory: history,
        preferredOutputChannel: message.metadata?.preferredOutputChannel,
        agentId: message.metadata?.agentId,
        messageChannel: message.metadata?.messageChannel,
      },
      availableCapabilities: capabilities.map(({ id, name, description, tags }) => ({
        id,
        name,
        description,
        tags: tags ?? [],
      })),
      availableOutputs: outputs.map(({ channel, description }) => ({
        channel,
        description: description ?? `Send the response to ${channel}`,
      })),
    },
    null,
    2,
  );
}

function currentUserText(message: InputMessage): string {
  return typeof message.metadata?.originalText === "string"
    ? message.metadata.originalText
    : message.text;
}
function shouldProposeMemory(text: string): boolean {
  return DURABLE_MEMORY_SIGNALS.some((signal) => signal.test(text));
}
const DURABLE_MEMORY_SIGNALS = [
  /\b(?:remember|save|store) (?:that|this)\b/i,
  /\b(?:ricorda|salva|memorizza)(?: che| questo| questa)?\b/i,
  /\bmy (?:name|birthday|job|role|company|project|preference|goal|hobby|partner|wife|husband|friend|colleague)\b/i,
  /\bi (?:am|live|work|prefer|like|love|hate|use|own|built|created|founded)\b/i,
  /\bmi chiamo\b/i,
  /\b(?:vivo|abito|lavoro|preferisco|uso|adoro|detesto)\b/i,
  /\bmi piace\b/i,
  /\bsono (?:un|una|il|la)\b/i,
];
function selectFallbackOutput(
  message: InputMessage,
  outputs: readonly OutputInterface[],
): OutputInterface {
  const preferred = message.metadata?.preferredOutputChannel;
  return (
    (typeof preferred === "string"
      ? outputs.find(({ channel }) => channel === preferred)
      : undefined) ??
    outputs.find(({ channel }) => channel === message.channel) ??
    outputs[0]!
  );
}
function selectExplicitDeliveryOutput(
  message: InputMessage,
  outputs: readonly OutputInterface[],
): OutputInterface | undefined {
  const text = currentUserText(message).toLowerCase();
  if (!DELIVERY_INTENT.test(text)) return undefined;
  return outputs.find(
    ({ channel }) =>
      channel !== message.channel && channelNames(channel).some((name) => text.includes(name)),
  );
}
function channelNames(channel: string): string[] {
  const normalized = channel.toLowerCase();
  return unique([
    normalized,
    normalized.replace(/[-_]/g, " "),
    ...normalized.split(/[-_]/).filter((part) => part.length > 2),
  ]);
}
function deliveryAcknowledgement(channel: string): string {
  return channel.toLowerCase() === "telegram"
    ? "Messaggio inviato su Telegram."
    : `Message sent to ${channel}.`;
}
const DELIVERY_INTENT =
  /\b(?:deliver|forward|message|send|write|dare|gira|inoltra|invia|inviami|manda|mandami|messaggio|scrivi)\b/i;
function sanitizeAdditionalOutputs(
  outputs: readonly ModelAdditionalOutput[] | undefined,
  channels: readonly string[],
  primary: string,
): ModelAdditionalOutput[] {
  const available = new Set(channels);
  const seen = new Set([primary]);
  const result: ModelAdditionalOutput[] = [];
  for (const output of outputs ?? []) {
    if (
      !available.has(output.outputChannel) ||
      seen.has(output.outputChannel) ||
      (output.content === "text" && output.text.trim() === "")
    )
      continue;
    seen.add(output.outputChannel);
    result.push({
      outputChannel: output.outputChannel,
      content: output.content,
      text: output.content === "text" ? output.text : "",
    });
  }
  return result;
}
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
function truncateText(value: unknown, max: number): unknown {
  return typeof value === "string" && value.length > max ? `${value.slice(0, max)}…` : value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
