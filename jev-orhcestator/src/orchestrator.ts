import { CompositeEnvironment } from "@agent-os/env-node";
import type {
  AIProvider,
  CapabilityDiscovery,
  CapabilityManifest,
  Environment,
  InputMessage,
  OrchestrationDecision,
  Orchestrator,
  OrchestratorOptions,
  OutputInterface,
} from "@agent-os/core/domain";
import { choice, noul, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";

export interface JevOrhcestatorOrchestratorOptions {
  env?: Environment;
  cwd?: string;
  workingDirectory?: string;
  capabilityDiscovery: CapabilityDiscovery;
  model?: AIProvider;
  maxCapabilities?: number;
  apiKey?: string;
  fetch?: Fetch;
}

const CAPABILITY_THRESHOLD = 0.5;
const MEMORY_THRESHOLD = 0.6;

export class JevOrhcestatorOrchestrator implements Orchestrator {
  private readonly env: Environment;
  private readonly capabilityDiscovery: CapabilityDiscovery;
  private readonly maxCapabilities: number;
  private readonly jevApiKey: string | undefined;
  private readonly fetch: Fetch | undefined;
  private client: TypeSafeClient | undefined;

  constructor(options: JevOrhcestatorOrchestratorOptions) {
    if (!options.capabilityDiscovery)
      throw new Error("JevOrhcestatorOrchestrator requires capability discovery");

    const cwd = options.cwd ?? options.workingDirectory ?? process.cwd();
    this.env = options.env ?? new CompositeEnvironment({ cwd });
    this.capabilityDiscovery = options.capabilityDiscovery;
    this.maxCapabilities = Math.max(0, options.maxCapabilities ?? 50);
    this.jevApiKey =
      options.apiKey ?? this.env.get("JEV_API_KEY") ?? this.env.get("TYPESAFE_API_KEY");
    this.fetch = options.fetch;
  }

  async orchestrate(
    message: InputMessage,
    outputs: readonly OutputInterface[],
    options: OrchestratorOptions = {},
  ): Promise<OrchestrationDecision> {
    const fallback = outputs.find((output) => output.channel === message.channel) ?? outputs[0];
    if (!fallback) throw new Error("JevOrhcestatorOrchestrator requires at least one output");

    const text = currentUserText(message);
    const candidates = await this.capabilityDiscovery.discover();

    try {
      const { answers } = await this.getClient().systemOne(
        {
          state: {
            text,
            channel: message.channel,
            capabilities: candidates.map(({ id, name, description }) => ({
              id,
              name,
              description,
            })),
            outputs: outputs.map(({ channel, description }) => ({
              channel,
              description: description ?? `Send the response to ${channel}`,
            })),
          },
          questions: routingQuestions(candidates, outputs),
        },
        { signal: options.signal },
      );

      const outputAnswer = answers.output;
      const outputChannel =
        outputAnswer?.type === "choice" &&
        outputs.some((output) => output.channel === outputAnswer.choice)
          ? outputAnswer.choice
          : fallback.channel;

      const capabilityIds = candidates
        .map((capability) => ({
          id: capability.id,
          noul: noulOf(answers, capabilityQuestionId(capability.id)),
        }))
        .filter((item) => item.noul >= CAPABILITY_THRESHOLD)
        .sort((left, right) => right.noul - left.noul)
        .slice(0, this.maxCapabilities)
        .map((item) => item.id);

      return {
        capabilityIds,
        outputChannel,
        additionalOutputs:
          outputChannel === fallback.channel
            ? []
            : [
                {
                  outputChannel: fallback.channel,
                  content: "text",
                  text: acknowledgement(outputChannel),
                },
              ],
        deferMemoryProposal: noulOf(answers, "memory") >= MEMORY_THRESHOLD,
        reason: `Jev selected ${capabilityIds.join(", ") || "no capabilities"} → ${outputChannel}.`,
      };
    } catch (error) {
      const fallbackCapabilities = await this.capabilityDiscovery.discover({
        text,
        limit: this.maxCapabilities,
      });
      return {
        capabilityIds: fallbackCapabilities.map(({ id }) => id),
        outputChannel: fallback.channel,
        additionalOutputs: [],
        reason: `Jev routing failed; used deterministic fallback: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private getClient(): TypeSafeClient {
    if (!this.client) {
      this.client = new TypeSafeClient({
        ...(this.jevApiKey ? { apiKey: this.jevApiKey } : {}),
        ...(this.fetch ? { fetch: this.fetch } : {}),
      });
    }
    return this.client;
  }
}

function routingQuestions(
  capabilities: readonly CapabilityManifest[],
  outputs: readonly OutputInterface[],
) {
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    memory: noul(
      "Does `text` state a durable fact, preference, relationship, or ongoing goal that should be remembered later?",
    ),
  };

  if (outputs.length > 1) {
    questions.output = choice(
      "Which output channel should receive the response? Prefer `channel` unless the user asks to send it somewhere else.",
      Object.fromEntries(
        outputs.map((output) => [
          output.channel,
          output.description ?? `Send the response to ${output.channel}`,
        ]),
      ),
    );
  }

  for (const capability of capabilities) {
    questions[capabilityQuestionId(capability.id)] = noul(
      `Would capability \`${capability.id}\` — ${capability.name}: ${capability.description} — materially help answer \`text\`?`,
    );
  }

  return questions;
}

function capabilityQuestionId(id: string): string {
  return `cap:${id}`;
}

function noulOf(answers: Record<string, { type?: string; noul?: number }>, key: string): number {
  const answer = answers[key];
  return answer?.type === "noul" && typeof answer.noul === "number" ? answer.noul : 0;
}

function currentUserText(message: InputMessage): string {
  return typeof message.metadata?.originalText === "string"
    ? message.metadata.originalText
    : message.text;
}

function acknowledgement(channel: string): string {
  return channel.toLowerCase() === "telegram"
    ? "Messaggio inviato su Telegram."
    : `Message sent to ${channel}.`;
}
