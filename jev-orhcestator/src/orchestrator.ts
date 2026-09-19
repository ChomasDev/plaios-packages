import { CompositeEnvironment } from "@agent-os/env-node";
import type {
  AIProvider,
  CapabilityDiscovery,
  CapabilityManifest,
  Environment,
  InputMessage,
  Memory,
  OrchestrationDecision,
  Orchestrator,
  OrchestratorOptions,
  OutputInterface,
} from "@agent-os/core/domain";
import { choice, noul, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";

import {
  findMatchingProtocol,
  parseProtocolRemember,
  protocolConfirmation,
  saveProtocol,
  type ProtocolMemory,
} from "./protocol.js";

export interface JevOrhcestatorOrchestratorOptions {
  env?: Environment;
  cwd?: string;
  workingDirectory?: string;
  capabilityDiscovery: CapabilityDiscovery;
  model?: AIProvider;
  memory?: Memory;
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
  private readonly memory: ProtocolMemory | undefined;
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
    this.memory = options.memory as ProtocolMemory | undefined;
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

    const remembered = await this.rememberProtocol(message, fallback.channel);
    if (remembered) return remembered;
    await this.expandProtocol(message);

    const text = currentUserText(message);
    const history = conversationHistory(message);
    const candidates = await this.capabilityDiscovery.discover();
    const protocolHint = protocolRoutingHint(message);

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
          questions: routingQuestions(candidates, outputs, history, protocolHint),
        },
        { signal: options.signal },
      );

      const outputAnswer = answers.output;
      const outputChannel = preferRequestedOutput(
        text,
        outputs,
        outputAnswer?.type === "choice" &&
          outputs.some((output) => output.channel === outputAnswer.choice)
          ? outputAnswer.choice
          : fallback.channel,
      );

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
      const multiStep =
        needsGenerativeModel(text) || noulOf(answers, "multiStep") >= DIRECT_THRESHOLD;
      const bypassModel = Boolean(direct) && !multiStep;
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
          : multiStep
            ? `Multi-step request sent to the generative model with ${capabilityIds.join(", ") || "no capabilities"} → ${outputChannel}.`
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

  private async rememberProtocol(
    message: InputMessage,
    outputChannel: string,
  ): Promise<OrchestrationDecision | undefined> {
    const remembered = parseProtocolRemember(currentUserText(message));
    if (!remembered) return undefined;
    await saveProtocol(this.memory, message.userId, remembered);
    message.metadata = {
      ...message.metadata,
      protocolRemembered: true,
      protocolTrigger: remembered.trigger,
      protocolConfirmation: protocolConfirmation(remembered),
    };
    return {
      capabilityIds: [],
      outputChannel,
      additionalOutputs: [],
      bypassModel: true,
      reason: `Remembered protocol "${remembered.trigger}" and stored it in graph memory.`,
    };
  }

  private async expandProtocol(message: InputMessage): Promise<void> {
    if (typeof message.metadata?.protocolTrigger === "string") return;
    const matched = await findMatchingProtocol(this.memory, message.userId, currentUserText(message));
    if (!matched) return;
    message.metadata = {
      ...message.metadata,
      originalText: matched.expansion,
      protocolTrigger: matched.trigger,
    };
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
  protocolHint = "",
) {
  const historyHint = history.length > 0
    ? " Resolve pronouns and follow-ups such as 'le metti blu' using the recent conversation in `history`."
    : "";
  const extraHint = `${historyHint}${protocolHint}`;
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    memory: noul(
      "Does `text` state a durable fact, preference, relationship, or ongoing goal that should be remembered later?",
    ),
    multiStep: noul(
      "Does `text` require more than one step, such as doing something and then inspecting, describing, or sending the result? Simple single commands like turning on a light or locking a Mac are not multi-step.",
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
      `Would capability \`${capability.id}\` — ${capability.name}: ${capability.description} — materially help answer \`text\`?${extraHint}`,
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

function protocolRoutingHint(message: InputMessage): string {
  const trigger = typeof message.metadata?.protocolTrigger === "string"
    ? message.metadata.protocolTrigger
    : "";
  return trigger
    ? ` \`text\` is the remembered action for protocol "${trigger}". Route that action, not the trigger phrase.`
    : "";
}

function needsGenerativeModel(text: string): boolean {
  const inspects = /\b(telegram|cosa vedi|che vedi|descrivi|descrizione|scrivimi|scrivermi|mandami|mandarmi|dimmi|dirmi|spiegami|raccontami|analizza|guarda)\b/i.test(
    text,
  );
  const acts = /\b(screenshot|schermata|cattura|mac|computer|luce|luci|tv|allarme|apri|chiudi|blocca|spegni|accendi|lock)\b/i.test(
    text,
  );
  if (inspects && acts) return true;
  if (/\b(e poi|and then|poi |then |dopo aver|e anche|and also|e successivamente)\b/i.test(text)) {
    return true;
  }
  const actionVerb =
    /\b(screenshot|schermata|cattura|apri|chiudi|blocca|lock|spegni|accendi|imposta|manda|scrivi|dimmi|descrivi|esegui)\b/i;
  const clauses = text.split(/\s+(?:e|and)\s+/i);
  return clauses.length >= 2 && clauses.filter((clause) => actionVerb.test(clause)).length >= 2;
}

function preferRequestedOutput(
  text: string,
  outputs: readonly OutputInterface[],
  selected: string,
): string {
  if (/\btelegram\b/i.test(text) && outputs.some((output) => output.channel === "telegram")) {
    return "telegram";
  }
  return selected;
}

function acknowledgement(channel: string): string {
  return channel.toLowerCase() === "telegram"
    ? "Messaggio inviato su Telegram."
    : `Message sent to ${channel}.`;
}
