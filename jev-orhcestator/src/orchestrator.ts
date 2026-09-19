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
const DIRECT_THRESHOLD = 0.7;
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
    const history = conversationHistory(message);
    const candidates = await this.capabilityDiscovery.discover();

    try {
      const { answers } = await this.getClient().systemOne(
        {
          state: {
            text,
            history,
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
          questions: routingQuestions(candidates, outputs, history),
        },
        { signal: options.signal },
      );

      const outputAnswer = answers.output;
      const outputChannel =
        outputAnswer?.type === "choice" &&
        outputs.some((output) => output.channel === outputAnswer.choice)
          ? outputAnswer.choice
          : fallback.channel;

      const ranked = candidates
        .map((capability) => ({
          capability,
          noul: noulOf(answers, capabilityQuestionId(capability.id)),
        }))
        .filter((item) => item.noul >= CAPABILITY_THRESHOLD)
        .sort((left, right) => right.noul - left.noul)
        .slice(0, this.maxCapabilities);

      const direct = ranked.find(
        (item) => item.noul >= DIRECT_THRESHOLD && item.capability.tags?.includes("direct"),
      );
      const bypassModel = Boolean(direct);
      const capabilityIds = bypassModel
        ? [direct!.capability.id]
        : ranked.map((item) => item.capability.id);

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
        bypassModel,
        reason: bypassModel
          ? `Jev sent the message directly to ${capabilityIds[0]}.`
          : `Jev selected ${capabilityIds.join(", ") || "no capabilities"} → ${outputChannel}.`,
      };
    } catch (error) {
      const fallbackCapabilities = await this.capabilityDiscovery.discover({
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
  history: Array<{ role: string; content: string }> = [],
) {
  const historyHint = history.length > 0
    ? " Resolve pronouns and follow-ups such as 'le metti blu' using the recent conversation in `history`."
    : "";
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
      `Would capability \`${capability.id}\` — ${capability.name}: ${capability.description} — materially help answer \`text\`?${historyHint}`,
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

const HISTORY_LIMIT = 10;

function currentUserText(message: InputMessage): string {
  const raw = typeof message.metadata?.originalText === "string"
    ? message.metadata.originalText
    : message.text;
  const turns = parseTranscriptTurns(raw);
  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  return lastUser?.content ?? raw;
}

function conversationHistory(
  message: InputMessage,
): Array<{ role: string; content: string }> {
  const value = message.metadata?.conversationHistory;
  const raw = typeof message.metadata?.originalText === "string"
    ? message.metadata.originalText
    : message.text;
  if (!Array.isArray(value)) return previousTranscriptTurns(raw).slice(-HISTORY_LIMIT);
  const turns = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const role = "role" in entry && typeof entry.role === "string" ? entry.role : "";
    const content = "content" in entry && typeof entry.content === "string" ? entry.content : "";
    return role && content ? [{ role, content }] : [];
  });
  if (turns.length > 0) return turns.slice(-HISTORY_LIMIT);
  return previousTranscriptTurns(
    typeof message.metadata?.originalText === "string" ? message.metadata.originalText : message.text,
  ).slice(-HISTORY_LIMIT);
}

function parseTranscriptTurns(text: string): Array<{ role: string; content: string }> {
  const trimmed = text.trim();
  if (!/(?:^|\n)(?:USER|ASSISTANT|SYSTEM):/i.test(trimmed)) return [];
  return trimmed
    .split(/\n(?=(?:USER|ASSISTANT|SYSTEM):)/i)
    .flatMap((block) => {
      const match = block.match(/^(USER|ASSISTANT|SYSTEM):\s*([\s\S]*)$/i);
      if (!match) return [];
      const content = match[2]!.trim();
      if (!content) return [];
      return [{ role: match[1]!.toLowerCase(), content }];
    });
}

function previousTranscriptTurns(text: string): Array<{ role: string; content: string }> {
  const turns = parseTranscriptTurns(text);
  let lastUserIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex > 0 ? turns.slice(0, lastUserIndex) : [];
}

function acknowledgement(channel: string): string {
  return channel.toLowerCase() === "telegram"
    ? "Messaggio inviato su Telegram."
    : `Message sent to ${channel}.`;
}
