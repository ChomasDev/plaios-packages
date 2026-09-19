import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@agent-os/core/domain";

export type HomeAssistantAction =
  | "get_states"
  | "turn_on"
  | "turn_off"
  | "toggle"
  | "set_brightness"
  | "set_color"
  | "set_temperature"
  | "set_hvac_mode"
  | "set_position"
  | "set_volume"
  | "volume_up"
  | "volume_down"
  | "mute"
  | "unmute"
  | "media_play"
  | "media_pause"
  | "media_stop"
  | "open"
  | "close"
  | "stop"
  | "lock"
  | "unlock"
  | "activate";

export interface HomeAssistantControlInput {
  entityId: string | null;
  action: HomeAssistantAction;
  value: number | null;
  option: string | null;
}

export interface HomeAssistantControlOutput {
  entities: HomeAssistantEntity[];
  count: number;
  service: string | null;
}

export interface HomeAssistantEntity {
  entityId: string;
  domain: string;
  name: string;
  state: string;
  available: boolean;
  lastChanged: string;
  icon?: string;
  deviceClass?: string;
  unit?: string;
  brightness?: number;
  colorTempKelvin?: number;
  currentTemperature?: number;
  targetTemperature?: number;
  hvacModes?: string[];
  position?: number;
  supportedFeatures?: number;
  volume?: number;
  muted?: boolean;
  source?: string;
  sources?: string[];
  mediaTitle?: string;
  mediaArtist?: string;
}

export interface HomeAssistantDashboard {
  connected: boolean;
  baseUrl: string;
  entities: HomeAssistantEntity[];
  updatedAt: string;
  error?: string;
}

export interface HomeAssistantCapabilityOptions {
  env: Environment;
  baseUrl?: string;
  token?: string;
  entityDomains?: readonly string[] | string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface HomeAssistantStateResponse {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

const legacyDefaultDomains = [
  "light",
  "switch",
  "fan",
  "cover",
  "lock",
  "climate",
  "scene",
  "script",
  "input_boolean",
] as const;
const defaultDomains = [...legacyDefaultDomains, "media_player"] as const;

const manifest: CapabilityManifest = {
  id: "home-assistant.control",
  version: "1.1.0",
  name: "control_home_assistant",
  description:
    "Reads live Home Assistant entity states and controls entities. Use get_states with a null entityId to answer which devices exist, are on, off, active, available, or unavailable. Control lights, switches, fans, TVs and other media players, input booleans, covers, locks, climate, scenes, and scripts. For TVs use set_volume with a 0-100 value, volume_up, volume_down, mute, unmute, media_play, media_pause, or media_stop.",
  inputSchema: {
    type: "object",
    properties: {
      entityId: {
        type: ["string", "null"],
        description: "Exact Home Assistant entity ID, such as light.kitchen, or null for get_states.",
      },
      action: {
        type: "string",
        enum: [
          "get_states",
          "turn_on",
          "turn_off",
          "toggle",
          "set_brightness",
          "set_color",
          "set_temperature",
          "set_hvac_mode",
          "set_position",
          "set_volume",
          "volume_up",
          "volume_down",
          "mute",
          "unmute",
          "media_play",
          "media_pause",
          "media_stop",
          "open",
          "close",
          "stop",
          "lock",
          "unlock",
          "activate",
        ],
        description: "Control operation to perform.",
      },
      value: {
        type: ["number", "null"],
        description:
          "Numeric setting: brightness, cover position, or media volume from 0 to 100, or the target temperature. Use null for other actions.",
      },
      option: {
        type: ["string", "null"],
        description: "Color name for set_color, HVAC mode for set_hvac_mode; otherwise null.",
      },
    },
    required: ["entityId", "action", "value", "option"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      entities: { type: "array", items: { type: "object" } },
      count: { type: "integer" },
      service: { type: ["string", "null"] },
    },
    required: ["entities", "count", "service"],
    additionalProperties: false,
  },
  permissions: ["network.http", "home-assistant.control"],
  tags: [
    "home-assistant",
    "smart-home",
    "state",
    "status",
    "devices",
    "light",
    "switch",
    "fan",
    "cover",
    "lock",
    "climate",
    "scene",
    "tv",
    "media-player",
  ],
  execution: { timeoutMs: 15_000, idempotent: false },
  examples: [
    {
      request: "Which devices are currently active at home?",
      arguments: {
        entityId: null,
        action: "get_states",
        value: null,
        option: null,
      },
    },
    {
      request: "Turn off the kitchen light",
      arguments: {
        entityId: "light.kitchen",
        action: "turn_off",
        value: null,
        option: null,
      },
    },
    {
      request: "Set the living room light to 40 percent",
      arguments: {
        entityId: "light.living_room",
        action: "set_brightness",
        value: 40,
        option: null,
      },
    },
    {
      request: "Set the living room TV volume to 20 percent",
      arguments: {
        entityId: "media_player.living_room_tv",
        action: "set_volume",
        value: 20,
        option: null,
      },
    },
  ],
};

export class HomeAssistantCapability
  implements Capability<HomeAssistantControlInput, HomeAssistantControlOutput>
{
  readonly manifest = manifest;

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly entityDomains: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(options: HomeAssistantCapabilityOptions) {
    const baseUrl = options.baseUrl ?? options.env.get("HOME_ASSISTANT_URL");
    const token = options.token ?? options.env.get("HOME_ASSISTANT_TOKEN");
    if (!baseUrl) throw new Error("HOME_ASSISTANT_URL is required for HomeAssistantCapability");
    if (!token) throw new Error("HOME_ASSISTANT_TOKEN is required for HomeAssistantCapability");

    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
    this.entityDomains = new Set(normalizeDomains(options.entityDomains));
    this.timeoutMs = Math.max(1_000, Math.trunc(options.timeoutMs ?? 10_000));
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async microfrontendData() {
    return {
      ...(await this.dashboard()),
      actions: {
        refresh: async () => this.dashboard(),
        control: async (input: HomeAssistantControlInput) => {
          const result = await this.performControl(input);
          if (!result.success) throw new Error(result.error.message);
          return this.dashboard();
        },
      },
    };
  }

  async execute(
    input: HomeAssistantControlInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<HomeAssistantControlOutput>> {
    if (context.signal?.aborted) {
      return failure("HOME_ASSISTANT_ABORTED", "Home Assistant control was aborted", true);
    }
    return this.performControl(input, context.signal);
  }

  private async dashboard(): Promise<HomeAssistantDashboard> {
    try {
      const entities = await this.liveEntities();
      return {
        connected: true,
        baseUrl: this.baseUrl,
        entities,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        connected: false,
        baseUrl: this.baseUrl,
        entities: [],
        updatedAt: new Date().toISOString(),
        error: errorMessage(error),
      };
    }
  }

  private async performControl(
    input: HomeAssistantControlInput,
    signal?: AbortSignal,
  ): Promise<CapabilityResult<HomeAssistantControlOutput>> {
    if (input.action === "get_states") {
      try {
        const entities = await this.liveEntities(signal);
        return { success: true, data: { entities, count: entities.length, service: null } };
      } catch (error) {
        return failure("HOME_ASSISTANT_REQUEST_FAILED", errorMessage(error), true);
      }
    }

    const entityId = input.entityId?.trim().toLowerCase() ?? "";
    if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId)) {
      return failure("VALIDATION_ERROR", "A valid Home Assistant entityId is required");
    }

    const domain = domainOf(entityId);
    if (!this.entityDomains.has(domain)) {
      return failure("ENTITY_DOMAIN_NOT_ALLOWED", `Entity domain \"${domain}\" is not enabled`);
    }

    let command: ServiceCommand;
    try {
      command = serviceCommand(domain, input);
    } catch (error) {
      return failure("ACTION_NOT_SUPPORTED", errorMessage(error));
    }

    try {
      await this.request(`/api/services/${command.domain}/${command.service}`, {
        method: "POST",
        body: JSON.stringify({ entity_id: entityId, ...command.data }),
        signal,
      });
      const state = await this.request<HomeAssistantStateResponse>(
        `/api/states/${encodeURIComponent(entityId)}`,
        { signal },
      );
      return {
        success: true,
        data: {
          entities: [toEntity(state)],
          count: 1,
          service: `${command.domain}.${command.service}`,
        },
      };
    } catch (error) {
      return failure("HOME_ASSISTANT_REQUEST_FAILED", errorMessage(error), true);
    }
  }

  private async liveEntities(signal?: AbortSignal): Promise<HomeAssistantEntity[]> {
    const states = await this.request<HomeAssistantStateResponse[]>("/api/states", { signal });
    return states
      .filter((state) => this.entityDomains.has(domainOf(state.entity_id)))
      .map(toEntity)
      .sort(compareEntities);
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Home Assistant returned ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

interface ServiceCommand {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
}

function serviceCommand(
  domain: string,
  input: HomeAssistantControlInput,
): ServiceCommand {
  const onOffDomains = new Set(["light", "switch", "fan", "input_boolean", "media_player"]);
  if (["turn_on", "turn_off", "toggle"].includes(input.action)) {
    if (!onOffDomains.has(domain)) throw new Error(`${input.action} is not supported for ${domain}`);
    return { domain, service: input.action };
  }
  if (input.action === "set_brightness" && domain === "light") {
    return { domain, service: "turn_on", data: { brightness_pct: percentage(input.value, "brightness") } };
  }
  if (input.action === "set_color" && domain === "light") {
    const color = resolveLightColor(input.option);
    if (!color) throw new Error("A light color is required");
    const data: Record<string, unknown> = { rgb_color: color.rgb };
    if (input.value != null && Number.isFinite(input.value)) {
      data.brightness_pct = percentage(input.value, "brightness");
    }
    return { domain, service: "turn_on", data };
  }
  if (input.action === "set_temperature" && domain === "climate") {
    if (input.value == null || !Number.isFinite(input.value)) throw new Error("A target temperature is required");
    return { domain, service: "set_temperature", data: { temperature: clamp(input.value, -50, 100) } };
  }
  if (input.action === "set_hvac_mode" && domain === "climate") {
    const hvacMode = input.option?.trim();
    if (!hvacMode) throw new Error("An HVAC mode is required");
    return { domain, service: "set_hvac_mode", data: { hvac_mode: hvacMode } };
  }
  if (input.action === "set_position" && domain === "cover") {
    return { domain, service: "set_cover_position", data: { position: percentage(input.value, "position") } };
  }
  if (input.action === "set_volume" && domain === "media_player") {
    return { domain, service: "volume_set", data: { volume_level: percentage(input.value, "volume") / 100 } };
  }
  if (["volume_up", "volume_down"].includes(input.action) && domain === "media_player") {
    return { domain, service: input.action };
  }
  if (["mute", "unmute"].includes(input.action) && domain === "media_player") {
    return { domain, service: "volume_mute", data: { is_volume_muted: input.action === "mute" } };
  }
  if (["media_play", "media_pause", "media_stop"].includes(input.action) && domain === "media_player") {
    return { domain, service: input.action };
  }
  if (["open", "close", "stop"].includes(input.action) && domain === "cover") {
    return { domain, service: `${input.action}_cover` };
  }
  if (["lock", "unlock"].includes(input.action) && domain === "lock") {
    return { domain, service: input.action };
  }
  if (input.action === "activate" && (domain === "scene" || domain === "script")) {
    return { domain, service: "turn_on" };
  }
  throw new Error(`${input.action} is not supported for ${domain}`);
}

const LIGHT_COLORS: Record<string, { rgb: [number, number, number]; labelIt: string; labelEn: string }> = {
  white: { rgb: [255, 255, 255], labelIt: "bianco", labelEn: "white" },
  bianco: { rgb: [255, 255, 255], labelIt: "bianco", labelEn: "white" },
  bianca: { rgb: [255, 255, 255], labelIt: "bianco", labelEn: "white" },
  bianche: { rgb: [255, 255, 255], labelIt: "bianco", labelEn: "white" },
  bianchi: { rgb: [255, 255, 255], labelIt: "bianco", labelEn: "white" },
  red: { rgb: [255, 0, 0], labelIt: "rosso", labelEn: "red" },
  rosso: { rgb: [255, 0, 0], labelIt: "rosso", labelEn: "red" },
  rossa: { rgb: [255, 0, 0], labelIt: "rosso", labelEn: "red" },
  rosse: { rgb: [255, 0, 0], labelIt: "rosso", labelEn: "red" },
  rossi: { rgb: [255, 0, 0], labelIt: "rosso", labelEn: "red" },
  green: { rgb: [0, 255, 0], labelIt: "verde", labelEn: "green" },
  verde: { rgb: [0, 255, 0], labelIt: "verde", labelEn: "green" },
  verdi: { rgb: [0, 255, 0], labelIt: "verde", labelEn: "green" },
  blue: { rgb: [0, 80, 255], labelIt: "blu", labelEn: "blue" },
  blu: { rgb: [0, 80, 255], labelIt: "blu", labelEn: "blue" },
  yellow: { rgb: [255, 220, 0], labelIt: "giallo", labelEn: "yellow" },
  giallo: { rgb: [255, 220, 0], labelIt: "giallo", labelEn: "yellow" },
  gialla: { rgb: [255, 220, 0], labelIt: "giallo", labelEn: "yellow" },
  gialle: { rgb: [255, 220, 0], labelIt: "giallo", labelEn: "yellow" },
  orange: { rgb: [255, 140, 0], labelIt: "arancione", labelEn: "orange" },
  arancione: { rgb: [255, 140, 0], labelIt: "arancione", labelEn: "orange" },
  pink: { rgb: [255, 105, 180], labelIt: "rosa", labelEn: "pink" },
  rosa: { rgb: [255, 105, 180], labelIt: "rosa", labelEn: "pink" },
  purple: { rgb: [160, 32, 240], labelIt: "viola", labelEn: "purple" },
  viola: { rgb: [160, 32, 240], labelIt: "viola", labelEn: "purple" },
  warm: { rgb: [255, 180, 80], labelIt: "caldo", labelEn: "warm white" },
  calda: { rgb: [255, 180, 80], labelIt: "caldo", labelEn: "warm white" },
  caldo: { rgb: [255, 180, 80], labelIt: "caldo", labelEn: "warm white" },
  calde: { rgb: [255, 180, 80], labelIt: "caldo", labelEn: "warm white" },
  cold: { rgb: [200, 220, 255], labelIt: "freddo", labelEn: "cool white" },
  fredda: { rgb: [200, 220, 255], labelIt: "freddo", labelEn: "cool white" },
  freddo: { rgb: [200, 220, 255], labelIt: "freddo", labelEn: "cool white" },
  fredde: { rgb: [200, 220, 255], labelIt: "freddo", labelEn: "cool white" },
};

export function resolveLightColor(value: string | null | undefined):
  | { rgb: [number, number, number]; key: string; labelIt: string; labelEn: string }
  | undefined {
  const token = value?.trim().toLowerCase();
  if (!token) return undefined;
  const color = LIGHT_COLORS[token];
  return color ? { ...color, key: token } : undefined;
}

export function colorFromText(text: string): ReturnType<typeof resolveLightColor> {
  const tokens = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const color = resolveLightColor(tokens[index]);
    if (color) return color;
  }
  return undefined;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HOME_ASSISTANT_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("HOME_ASSISTANT_URL must not contain credentials");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeDomains(value: readonly string[] | string | undefined): string[] {
  const domains = typeof value === "string" ? value.split(",") : value ?? defaultDomains;
  const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))];
  if (sameDomains(normalized, legacyDefaultDomains)) normalized.push("media_player");
  return normalized;
}

function sameDomains(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((domain) => right.some((candidate) => candidate === domain));
}

function toEntity(state: HomeAssistantStateResponse): HomeAssistantEntity {
  const attributes = state.attributes ?? {};
  const brightness = numberAttribute(attributes.brightness);
  return {
    entityId: state.entity_id,
    domain: domainOf(state.entity_id),
    name: stringAttribute(attributes.friendly_name) ?? humanizeEntityId(state.entity_id),
    state: state.state,
    available: state.state !== "unavailable" && state.state !== "unknown",
    lastChanged: state.last_changed,
    icon: stringAttribute(attributes.icon),
    deviceClass: stringAttribute(attributes.device_class),
    unit: stringAttribute(attributes.unit_of_measurement),
    brightness: brightness === undefined ? undefined : Math.round((brightness / 255) * 100),
    colorTempKelvin: numberAttribute(attributes.color_temp_kelvin),
    currentTemperature: numberAttribute(attributes.current_temperature),
    targetTemperature: numberAttribute(attributes.temperature),
    hvacModes: stringArrayAttribute(attributes.hvac_modes),
    position: numberAttribute(attributes.current_position),
    supportedFeatures: numberAttribute(attributes.supported_features),
    volume: percentageAttribute(attributes.volume_level),
    muted: booleanAttribute(attributes.is_volume_muted),
    source: stringAttribute(attributes.source),
    sources: stringArrayAttribute(attributes.source_list),
    mediaTitle: stringAttribute(attributes.media_title),
    mediaArtist: stringAttribute(attributes.media_artist),
  };
}

function compareEntities(left: HomeAssistantEntity, right: HomeAssistantEntity): number {
  if (left.available !== right.available) return left.available ? -1 : 1;
  return left.name.localeCompare(right.name);
}

function domainOf(entityId: string): string {
  return entityId.split(".", 1)[0] ?? "";
}

function humanizeEntityId(entityId: string): string {
  return (entityId.split(".")[1] ?? entityId)
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanAttribute(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function percentageAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(clamp(value * 100, 0, 100))
    : undefined;
}

function stringArrayAttribute(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function percentage(value: number | null, label: string): number {
  if (value == null || !Number.isFinite(value)) throw new Error(`A ${label} percentage is required`);
  return Math.round(clamp(value, 0, 100));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  code: string,
  message: string,
  retryable = false,
): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
