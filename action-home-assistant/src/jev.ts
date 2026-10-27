import { choice, compactTurns, noul, noulOf } from "@agent-os/systems";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  System1,
  System2,
  SystemAnswers,
  SystemQuestions,
} from "@agent-os/core/domain";

import {
  CONTROLLABLE_DOMAINS,
  HomeAssistantCapability,
  colorFromText,
  errorMessage,
  failure,
  type HomeAssistantAction,
  type HomeAssistantCapabilityOptions,
  type HomeAssistantEntity,
} from "./capability.js";

export interface HomeAssistantJevInput {
  text: string;
  history?: Array<{ role: string; content: string }>;
}

export interface HomeAssistantJevOutput {
  action: HomeAssistantAction | "none";
  entities: HomeAssistantEntity[];
  count: number;
  summary: string;
  service: string | null;
}

export interface HomeAssistantJevCapabilityOptions extends HomeAssistantCapabilityOptions {
  system1?: System1;
  system2?: System2;
}

const ENTITY_THRESHOLD = 0.5;
const ACTIONS = {
  get_states: "Report device status without changing anything",
  turn_on: "Turn devices on",
  turn_off: "Turn devices off",
  toggle: "Toggle devices on or off",
  set_brightness: "Set light brightness to a percentage",
  set_color: "Set light color, for example white, green, red, blu, caldo, or freddo",
  set_temperature: "Set a climate target temperature",
  set_hvac_mode: "Set a climate HVAC mode",
  set_position: "Set a cover position as a percentage",
  set_volume: "Set media volume to a percentage",
  volume_up: "Increase media volume",
  volume_down: "Decrease media volume",
  mute: "Mute media",
  unmute: "Unmute media",
  media_play: "Play media",
  media_pause: "Pause media",
  media_stop: "Stop media",
  open: "Open a cover",
  close: "Close a cover",
  stop: "Stop a moving cover",
  lock: "Lock a lock",
  unlock: "Unlock a lock",
  activate: "Activate a scene or script",
  none: "Not a home-control command",
} as const;

const DOCS = `# control_home_assistant_jev

Takes the user's smart-home request in natural language and executes it on Home Assistant. System 1 (Jev) picks the action and scores which entities the text means (System 2 when System 1 is missing or fails); no generative model is involved. A request with several commands ("apri il cancello e spegni la tv") is split and run in order.

## When to use
- Default for smart-home requests phrased by the user: on/off, dimming, colors, TV volume, covers, climate, scenes, "quali luci sono accese?".
- Prefer \`control_home_assistant\` when you already know the exact \`entityId\` and action, or need the raw entity list.
- To just show cameras or device tiles, write the \`HomeCameras\` / \`HomeDevices\` chat components instead of calling any tool.

## Inputs
- \`{"text": "Spegni tutte le luci dell'ufficio"}\`
- \`{"text": "e mettila al 30%", "history": [{"role": "user", "content": "Accendi la luce della cucina"}]}\` for follow-ups.
Pass the user's words as-is, not a rewritten command.

## Result
\`summary\` is the reply to relay. In the web chat it is already an OpenUI answer with a \`HomeDevices\` card for the touched entities: output it unchanged. \`action: "none"\` means the text was not a home command.

## Limits and failures
- Call timeout 20s; only entities in the configured domain allowlist are matched.
- When no entity matches clearly, nothing is changed and \`summary\` says so or asks which device: relay it.
- \`JEV_REQUEST_FAILED\` (retryable) when neither System 1 nor System 2 answered; Home Assistant errors are the same as \`control_home_assistant\`.
- No confirmation step: locks, gates and covers act immediately.
`;

const manifest: CapabilityManifest = {
  id: "home-assistant.jev",
  version: "1.0.0",
  name: "control_home_assistant_jev",
  description:
    "Takes a natural-language smart-home command and executes it. Handles lights, switches, TVs, covers, climate, scenes, and other Home Assistant devices without a generative model. Examples: turn off all the lights in the office, set the living room TV volume to 20, which lights are on.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The user's smart-home request in natural language.",
      },
      history: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string" },
            content: { type: "string" },
          },
        },
        description: "Recent conversation turns used to resolve follow-up commands.",
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      action: { type: "string" },
      entities: { type: "array", items: { type: "object" } },
      count: { type: "integer" },
      summary: { type: "string" },
      service: { type: ["string", "null"] },
    },
    required: ["action", "entities", "count", "summary", "service"],
    additionalProperties: false,
  },
  permissions: ["network.http", "home-assistant.control"],
  tags: [
    "direct",
    "home-assistant",
    "smart-home",
    "lights",
    "light",
    "luci",
    "luce",
    "spegnere",
    "accendi",
    "ufficio",
    "switch",
    "tv",
    "media-player",
    "climate",
    "cover",
  ],
  execution: { timeoutMs: 20_000, idempotent: false },
  examples: [
    { request: "Turn off all the lights in the office", arguments: { text: "Turn off all the lights in the office" } },
    { request: "Accendi la luce della cucina", arguments: { text: "Accendi la luce della cucina" } },
  ],
};

export class HomeAssistantJevCapability
  implements Capability<HomeAssistantJevInput, HomeAssistantJevOutput>
{
  readonly manifest = manifest;
  private readonly control: HomeAssistantCapability;
  private readonly system1: System1 | undefined;
  private readonly system2: System2 | undefined;

  constructor(options: HomeAssistantJevCapabilityOptions) {
    this.control = new HomeAssistantCapability(options);
    this.system1 = options.system1;
    this.system2 = options.system2;
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  microfrontendData() {
    return this.control.microfrontendData();
  }

  async execute(
    input: HomeAssistantJevInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<HomeAssistantJevOutput>> {
    const result = await this.run(input, context);
    if (context.metadata?.channel !== "web") return result;
    return withDeviceCard(result);
  }

  private async run(
    input: HomeAssistantJevInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<HomeAssistantJevOutput>> {
    const text = input.text?.trim() ?? "";
    if (!text) return failure("VALIDATION_ERROR", "A natural-language home command is required");
    const history = compactTurns(input.history, 8);

    // "apri il cancello e spegni la tv": Jev picks one action per request, so a first
    // Jev pass finds where separate commands start, then each one runs in order.
    const commands = await this.splitWithJev(text, context);
    if (commands.length === 1) return this.executeOne(text, history, context);

    const results: Array<CapabilityResult<HomeAssistantJevOutput>> = [];
    for (const command of commands) {
      results.push(await this.executeOne(command, history, context));
    }
    const done = results.flatMap((result) => (result.success ? [result.data] : []));
    if (done.length === 0) return results[0] as CapabilityResult<HomeAssistantJevOutput>;
    const summary = results
      .map((result) => (result.success ? result.data.summary : result.error.message))
      .join(" ");
    const entities = done.flatMap((data) => data.entities);
    return {
      success: true,
      data: {
        action: done.find((data) => data.action !== "none")?.action ?? "none",
        entities,
        count: entities.length,
        summary,
        service: done.find((data) => data.service)?.service ?? null,
      },
    };
  }

  // Jev can't write text, so the first pass asks how many separate commands `text`
  // holds and scores every gap between words ("does a new command start here?"); the
  // text is cut at the best-scoring gaps. Falls back to the verb rule if Jev fails.
  private async splitWithJev(text: string, context: CapabilityExecutionContext): Promise<string[]> {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 4) return [text];
    if (words.length > MAX_SPLIT_WORDS) return splitCommands(text);

    let answers: SystemAnswers;
    try {
      answers = await this.ask(
        { text },
        {
          count: choice(
            "How many separate smart-home commands does `text` contain? Each command is one action on one or more devices: 'accendi la luce e il led' is 1, 'apri il cancello e spegni la tv' is 2.",
            COMMAND_COUNTS,
          ),
          ...Object.fromEntries(
            words.slice(1).map((_, index) => {
              const at = index + 1;
              return [
                splitQuestionId(at),
                noul(
                  `In \`text\`, does a new, separate smart-home command start at "${words.slice(at).join(" ")}", so that "${words.slice(0, at).join(" ")}" is already a complete command? Yes for two different actions, like "apri il cancello" then "spegni la tv". No when the words continue the same command, like "accendi la luce" then "e il led".`,
                ),
              ];
            }),
          ),
        },
        context.signal,
      );
    } catch {
      return splitCommands(text);
    }

    const count = Number(answers.count?.choice ?? "1");
    if (!Number.isInteger(count) || count < 2) return [text];

    // Best-scoring gaps first, keeping every piece at least MIN_COMMAND_WORDS long
    const ranked = words
      .slice(1)
      .map((_, index) => ({ at: index + 1, score: noulOf(answers, splitQuestionId(index + 1)) }))
      .sort((a, b) => b.score - a.score);
    const cuts: number[] = [];
    for (const { at } of ranked) {
      if (cuts.length === count - 1) break;
      const bounds = [0, ...cuts, words.length].sort((a, b) => a - b);
      const fits = bounds.every((bound) => Math.abs(bound - at) >= MIN_COMMAND_WORDS);
      if (fits) cuts.push(at);
    }

    const bounds = [0, ...cuts.sort((a, b) => a - b), words.length];
    const commands = bounds
      .slice(1)
      .map((end, index) => trimConnectors(words.slice(bounds[index], end).join(" ")))
      .filter(Boolean);
    return commands.length > 0 ? commands : [text];
  }

  // System 1 is optional: without it, or when it fails, System 2 answers.
  private async ask(
    state: Record<string, unknown>,
    questions: SystemQuestions,
    signal?: AbortSignal,
  ): Promise<SystemAnswers> {
    if (this.system1) {
      try {
        return await this.system1.ask(state, questions, { signal });
      } catch (error) {
        if (!this.system2 || signal?.aborted) throw error;
      }
    }
    if (!this.system2) throw new Error("No System 1 or System 2 is configured");
    return this.system2.ask(state, questions, { signal });
  }

  private async executeOne(
    text: string,
    history: Array<{ role: string; content: string }>,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<HomeAssistantJevOutput>> {
    const historyText = formatHistory(history);

    const states = await this.control.execute(
      { entityId: null, action: "get_states", value: null, option: null },
      context,
    );
    if (!states.success) {
      return failure(states.error.code, states.error.message, states.error.retryable);
    }
    // Jev scores every candidate entity; cameras and sensors can never be the target of a command.
    const entities = states.data.entities.filter((entity) => CONTROLLABLE_DOMAINS.has(entity.domain));
    if (entities.length === 0) {
      return success("none", [], "I couldn't find any Home Assistant devices.");
    }

    let answers: SystemAnswers;
    try {
      answers = await this.ask(
        {
          text,
          history,
          entities: entities.map(({ entityId, name, domain, state, available }) => ({
            entityId,
            name,
            domain,
            state,
            available,
          })),
        },
        {
          action: choice(
            "What home-control action should be taken for `text`? Use `set_color` when the user names a color such as white, green, rosso, or blu. Prefer `none` if this is not a device command or status question. Follow-ups such as 'make them green' should reuse the devices from `history`.",
            ACTIONS,
          ),
          ...Object.fromEntries(
            entities.map((entity) => [
              entityQuestionId(entity.entityId),
              noul(
                `Does \`text\`, or the recent conversation in \`history\`${historyText ? ` (${historyText})` : ""}, target the ${entity.domain} named "${entity.name}" (\`${entity.entityId}\`, currently ${entity.state})?`,
              ),
            ]),
          ),
        },
        context.signal,
      );
    } catch (error) {
      return failure("JEV_REQUEST_FAILED", errorMessage(error), true);
    }

    const italian = isItalian([text, historyText].join(" "));
    const color = colorFromText(text);
    const action = resolveAction(selectedAction(answers.action?.choice), color);
    const selected = targetsFor(
      action,
      entities
        .map((entity) => ({ entity, score: noulOf(answers, entityQuestionId(entity.entityId)) }))
        .filter(({ score }) => score >= ENTITY_THRESHOLD),
    );

    if (action === "none") {
      return success(
        "none",
        [],
        italian
          ? "Non mi sembra un comando per la casa. Puoi dirmi cosa vuoi accendere, spegnere o cambiare?"
          : "That doesn't look like a home-control command.",
      );
    }

    if (action === "get_states") {
      const listed = selected.length > 0 ? selected : entities;
      return success("get_states", listed, formatStatus(listed, italian));
    }

    if (selected.length === 0) {
      return success(
        action,
        [],
        italian
          ? "Non ho capito a quale dispositivo ti riferisci. Puoi dirmi la stanza o il nome della luce?"
          : "I couldn't match that request to a device. Can you name the room or the light?",
      );
    }

    if (action === "set_color" && !color) {
      return success(
        action,
        selected,
        italian
          ? `Ho trovato ${joinNames(selected, italian)}, ma non ho capito il colore. Prova con bianco, verde, rosso o blu.`
          : `I found ${joinNames(selected, italian)}, but I need a color such as white, green, red, or blue.`,
      );
    }

    const value = numericValue(text, action);
    if (action === "set_brightness" && value == null) {
      return success(
        action,
        selected,
        italian
          ? `Ho trovato ${joinNames(selected, italian)}, ma mi manca la percentuale di luminosità. Per esempio: mettile al 40%.`
          : `I found ${joinNames(selected, italian)}, but I need a brightness percentage. For example: set them to 40%.`,
      );
    }

    const results: HomeAssistantEntity[] = [];
    const services = new Set<string>();
    const errors: string[] = [];

    for (const entity of selected) {
      const result = await this.control.execute(
        { entityId: entity.entityId, action, value, option: color?.key ?? null },
        context,
      );
      if (result.success) {
        results.push(...result.data.entities);
        if (result.data.service) services.add(result.data.service);
      } else {
        errors.push(entity.name);
      }
    }

    if (results.length === 0) {
      return success(
        action,
        selected,
        italian
          ? `Ho provato a comandare ${joinNames(selected, italian)}, ma Home Assistant non ha applicato la modifica.`
          : `I tried to control ${joinNames(selected, italian)}, but Home Assistant did not apply the change.`,
      );
    }

    return success(
      action,
      results,
      formatCommand(action, results, { italian, color, errors }),
      [...services][0] ?? null,
    );
  }
}

const MAX_SPLIT_WORDS = 40;
const MIN_COMMAND_WORDS = 2;
const COMMAND_COUNTS = {
  "1": "A single command",
  "2": "Two separate commands",
  "3": "Three separate commands",
  "4": "Four or more separate commands",
} as const;

function splitQuestionId(at: number): string {
  return `split:${at}`;
}

// Drops joining words left at the edges of a piece: "e spegni la tv" -> "spegni la tv".
function trimConnectors(command: string): string {
  const connector = /^(?:e|ed|poi|quindi|anche|dopo|and|then|also)$/i;
  const words = command.replace(/[,;.]+/g, " ").split(/\s+/).filter(Boolean);
  while (words.length > 0 && connector.test(words[0] ?? "")) words.shift();
  while (words.length > 0 && connector.test(words.at(-1) ?? "")) words.pop();
  return words.join(" ");
}

// Fallback when the splitter Jev is unavailable.
const COMMAND_VERB =
  /^(accendi|spegni|apri|chiudi|attiva|disattiva|inserisci|disinserisci|metti|togli|imposta|alza|abbassa|aumenta|diminuisci|avvia|ferma|blocca|sblocca|mostra|fammi|turn|switch|open|close|set|start|stop|lock|unlock|activate|show|mute|unmute|play|pause)\b/i;

// Splits "apri il cancello e spegni la tv" into separate commands. A piece only
// becomes its own command when it starts with a verb, so "accendi la luce e il led"
// stays a single request.
export function splitCommands(text: string): string[] {
  const pieces = text
    .split(/\s*[,;]\s*(?:e\s+|ed\s+|poi\s+|and\s+|then\s+)?|\s+(?:e|ed|poi|and|then)\s+(?:poi\s+|then\s+)?/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const commands: string[] = [];
  for (const piece of pieces) {
    if (commands.length > 0 && !COMMAND_VERB.test(piece)) {
      commands[commands.length - 1] = `${commands[commands.length - 1]} e ${piece}`;
    } else {
      commands.push(piece);
    }
  }
  return commands.length > 0 ? commands : [text];
}

function formatHistory(history: readonly { role: string; content: string }[]): string {
  return history
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join(" | ")
    .slice(0, 500);
}

function selectedAction(value: string | undefined): HomeAssistantAction | "none" {
  if (value && value in ACTIONS) return value as HomeAssistantAction | "none";
  return "none";
}

function resolveAction(
  action: HomeAssistantAction | "none",
  color: ReturnType<typeof colorFromText>,
): HomeAssistantAction | "none" {
  if (color && (action === "none" || ["set_brightness", "set_temperature", "set_hvac_mode", "turn_on", "set_color"].includes(action))) {
    return "set_color";
  }
  return action;
}

// "Show the cameras on the TV" matches both the script and the TV itself; only the
// script can be activated, so don't report the TV as a failed change. Scripts are
// distinct routines (alarm modes, open/close pairs), so running several matches in a
// row is never what was asked: activate only the best match.
function targetsFor(
  action: HomeAssistantAction | "none",
  selected: ReadonlyArray<{ entity: HomeAssistantEntity; score: number }>,
): HomeAssistantEntity[] {
  if (action !== "activate") return selected.map(({ entity }) => entity);
  const activatable = selected.filter(
    ({ entity }) => entity.domain === "scene" || entity.domain === "script",
  );
  if (activatable.length === 0) return selected.map(({ entity }) => entity);
  const best = activatable.reduce((top, candidate) => (candidate.score > top.score ? candidate : top));
  return [best.entity];
}

function entityQuestionId(entityId: string): string {
  return `ent:${entityId}`;
}

function numericValue(text: string, action: HomeAssistantAction): number | null {
  if (!["set_brightness", "set_temperature", "set_position", "set_volume", "set_color"].includes(action)) {
    return null;
  }
  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function isItalian(text: string): boolean {
  return /\b(accendi|spegni|spegnere|imposta|metti|apri|chiudi|togli|mostra|fammi|vedere|inserisci|protocollo|antifurto|allarme|tutte|tutti|luci|luce|ufficio|cucina|salotto|telecamere|televisione|cancello|bianche|bianca|verdi|rosso|giallo)\b/i.test(
    text,
  );
}

function joinNames(entities: readonly { name: string }[], italian: boolean): string {
  const names = entities.map((entity) => entity.name);
  if (names.length === 0) return italian ? "i dispositivi" : "the devices";
  if (names.length === 1) return names[0] ?? "";
  const last = names.at(-1);
  return `${names.slice(0, -1).join(", ")} ${italian ? "e" : "and"} ${last}`;
}

function formatStatus(entities: readonly HomeAssistantEntity[], italian: boolean): string {
  if (entities.length === 0) {
    return italian ? "Non ho trovato dispositivi corrispondenti." : "No matching devices.";
  }
  const details = entities
    .map((entity) =>
      italian
        ? `${entity.name} è ${entity.state === "on" ? "accesa" : entity.state === "off" ? "spenta" : entity.state}`
        : `${entity.name} is ${entity.state}`,
    )
    .join("; ");
  return italian
    ? `Ecco lo stato che vedo: ${details}.`
    : `Here's what I see: ${details}.`;
}

function formatCommand(
  action: HomeAssistantAction,
  entities: readonly HomeAssistantEntity[],
  options: {
    italian: boolean;
    color?: ReturnType<typeof colorFromText>;
    errors: string[];
  },
): string {
  const names = joinNames(entities, options.italian);
  const color = options.italian ? options.color?.labelIt : options.color?.labelEn;
  const lines: Partial<Record<HomeAssistantAction, string>> = options.italian
    ? {
        turn_on: `Fatto, ho acceso ${names}.`,
        turn_off: `Fatto, ho spento ${names}.`,
        toggle: `Fatto, ho cambiato lo stato di ${names}.`,
        set_brightness: `Ho regolato la luminosità di ${names}.`,
        set_color: `Ho impostato ${names} sul ${color ?? "colore richiesto"}.`,
        set_temperature: `Ho impostato la temperatura di ${names}.`,
        set_volume: `Ho cambiato il volume di ${names}.`,
        set_position: `Ho cambiato la posizione di ${names}.`,
        open: `Ho aperto ${names}.`,
        close: `Ho chiuso ${names}.`,
        lock: `Ho chiuso ${names}.`,
        unlock: `Ho aperto ${names}.`,
        activate: `Ho attivato ${names}.`,
        media_play: `Ho avviato ${names}.`,
        media_pause: `Ho messo in pausa ${names}.`,
        media_stop: `Ho fermato ${names}.`,
        mute: `Ho silenziato ${names}.`,
        unmute: `Ho riattivato l'audio di ${names}.`,
        volume_up: `Ho alzato il volume di ${names}.`,
        volume_down: `Ho abbassato il volume di ${names}.`,
      }
    : {
        turn_on: `Done, I turned on ${names}.`,
        turn_off: `Done, I turned off ${names}.`,
        toggle: `Done, I toggled ${names}.`,
        set_brightness: `I adjusted the brightness on ${names}.`,
        set_color: `I set ${names} to ${color ?? "the requested color"}.`,
        set_temperature: `I set the temperature on ${names}.`,
        set_volume: `I changed the volume on ${names}.`,
        set_position: `I changed the position of ${names}.`,
        open: `I opened ${names}.`,
        close: `I closed ${names}.`,
        lock: `I locked ${names}.`,
        unlock: `I unlocked ${names}.`,
        activate: `I activated ${names}.`,
        media_play: `I started ${names}.`,
        media_pause: `I paused ${names}.`,
        media_stop: `I stopped ${names}.`,
        mute: `I muted ${names}.`,
        unmute: `I unmuted ${names}.`,
        volume_up: `I turned the volume up on ${names}.`,
        volume_down: `I turned the volume down on ${names}.`,
      };
  const summary = lines[action] ?? (options.italian ? `Fatto, ho aggiornato ${names}.` : `Done, I updated ${names}.`);
  if (options.errors.length === 0) return summary;
  return options.italian
    ? `${summary} Non sono riuscito a cambiare ${joinNames(options.errors.map((name) => ({ name })), true)}.`
    : `${summary} I couldn't change ${joinNames(options.errors.map((name) => ({ name })), false)}.`;
}

const MAX_CARD_ENTITIES = 24;

/**
 * The web chat renders OpenUI Lang, so there the summary becomes the sentence plus live HomeDevices tiles of the
 * entities it is about; other channels keep the plain text.
 */
export function withDeviceCard(result: CapabilityResult<HomeAssistantJevOutput>): CapabilityResult<HomeAssistantJevOutput> {
  if (!result.success || result.data.entities.length === 0) return result;
  const ids = [...new Set(result.data.entities.map((entity) => entity.entityId))].slice(0, MAX_CARD_ENTITIES);
  const summary = [
    "root = Stack([message, devices])",
    `message = TextContent(${JSON.stringify(leadSentence(result.data.summary))})`,
    `devices = HomeDevices("", ${JSON.stringify(ids)})`,
  ].join("\n");
  return { ...result, data: { ...result.data, summary } };
}

/** The tiles already list every device, so a long "Ecco lo stato che vedo: a, b, c…" keeps only its lead. */
function leadSentence(summary: string): string {
  const colon = summary.indexOf(":");
  if (summary.length <= 160 || colon < 0) return summary;
  return `${summary.slice(0, colon).trim()}.`;
}

function success(
  action: HomeAssistantAction | "none",
  entities: HomeAssistantEntity[],
  summary: string,
  service: string | null = null,
): CapabilityResult<HomeAssistantJevOutput> {
  return {
    success: true,
    data: { action, entities, count: entities.length, summary, service },
  };
}
