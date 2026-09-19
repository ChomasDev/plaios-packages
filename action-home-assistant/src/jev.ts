import { choice, noul, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import type { Capability, CapabilityExecutionContext, CapabilityManifest, CapabilityResult } from "@agent-os/core/domain";

import {
  HomeAssistantCapability,
  colorFromText,
  type HomeAssistantAction,
  type HomeAssistantCapabilityOptions,
  type HomeAssistantControlOutput,
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
  apiKey?: string;
  typesafeFetch?: Fetch;
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
  private readonly apiKey: string | undefined;
  private readonly typesafeFetch: Fetch | undefined;
  private client: TypeSafeClient | undefined;

  constructor(options: HomeAssistantJevCapabilityOptions) {
    this.control = new HomeAssistantCapability(options);
    this.apiKey =
      options.apiKey ?? options.env.get("JEV_API_KEY") ?? options.env.get("TYPESAFE_API_KEY");
    this.typesafeFetch = options.typesafeFetch;
  }

  microfrontendData() {
    return this.control.microfrontendData();
  }

  async execute(
    input: HomeAssistantJevInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<HomeAssistantJevOutput>> {
    const text = input.text?.trim() ?? "";
    if (!text) return failure("VALIDATION_ERROR", "A natural-language home command is required");
    const history = compactTurns(input.history);
    const historyText = formatHistory(history);

    const states = await this.control.execute(
      { entityId: null, action: "get_states", value: null, option: null },
      context,
    );
    if (!states.success) {
      return failure(states.error.code, states.error.message, states.error.retryable);
    }
    const entities = states.data.entities;
    if (entities.length === 0) {
      return success("none", [], "I couldn't find any Home Assistant devices.");
    }

    let answers: Record<string, { type?: string; choice?: string; noul?: number }>;
    try {
      const response = await this.getClient().systemOne(
        {
          state: {
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
          questions: {
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
        },
        { signal: context.signal },
      );
      answers = response.answers;
    } catch (error) {
      return failure(
        "JEV_REQUEST_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
      );
    }

    const italian = isItalian([text, historyText].join(" "));
    const color = colorFromText(text);
    const action = resolveAction(selectedAction(answers.action?.choice), color);
    const selected = entities.filter(
      (entity) => noulOf(answers, entityQuestionId(entity.entityId)) >= ENTITY_THRESHOLD,
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

    const results: HomeAssistantControlOutput["entities"] = [];
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

  private getClient(): TypeSafeClient {
    if (!this.client) {
      this.client = new TypeSafeClient({
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        ...(this.typesafeFetch ? { fetch: this.typesafeFetch } : {}),
      });
    }
    return this.client;
  }
}

function compactTurns(
  value: HomeAssistantJevInput["history"],
): Array<{ role: string; content: string }> {
  return (value ?? []).flatMap((entry) => {
    const role = entry?.role?.trim();
    const content = entry?.content?.trim();
    return role && content ? [{ role, content }] : [];
  }).slice(-8);
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

function entityQuestionId(entityId: string): string {
  return `ent:${entityId}`;
}

function noulOf(answers: Record<string, { type?: string; noul?: number }>, key: string): number {
  const answer = answers[key];
  return answer?.type === "noul" && typeof answer.noul === "number" ? answer.noul : 0;
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
  return /\b(accendi|spegni|spegnere|imposta|metti|tutte|tutti|luci|luce|ufficio|cucina|salotto|bianche|bianca|verdi|rosso|giallo)\b/i.test(
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
    .join(italian ? "; " : "; ");
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

function failure(
  code: string,
  message: string,
  retryable = false,
): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
