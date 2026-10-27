import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  SshCapability,
  type SshCapabilityOptions,
} from "@plaios/action-ssh";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@plaios/core/domain";
import { BundledGodsEyeViewServer } from "./server.js";

export type GodsEyeViewLayer =
  | "cameras"
  | "flights"
  | "vessels"
  | "satellites"
  | "earthquakes"
  | "traffic"
  | "radio"
  | "all";

export interface GodsEyeViewInput {
  query: string;
  location: string | null;
  layer: GodsEyeViewLayer | null;
  deviceId: string | null;
  actionName?: GodsEyeViewActionName | null;
  actionArguments?: Record<string, unknown> | null;
  mapStack?: "photoreal" | "bing-aerial" | "bing-labels" | "esri-imagery" | "mapbox" | "osm" | null;
  openOnMac?: boolean | null;
}

export type GodsEyeViewActionName = (typeof ACTION_NAMES)[number];

export interface GodsEyeViewCommand {
  name: GodsEyeViewActionName;
  arguments: Record<string, unknown>;
}

export interface GodsEyeViewCommandEnvelope {
  sequence: number;
  query: string;
  commands: GodsEyeViewCommand[];
  url: string;
  createdAt: string;
}

export interface GodsEyeCoordinates {
  latitude: number;
  longitude: number;
}

export interface GodsEyeViewOutput {
  url: string;
  location: string | null;
  coordinates: GodsEyeCoordinates | null;
  layer: GodsEyeViewLayer | null;
  opened: boolean;
  deviceId: string | null;
  coverageNotice: string | null;
  summary: string;
  commandSequence: number;
}

export interface GodsEyeViewDashboard {
  baseUrl: string;
  repositoryUrl: string;
  protocolTrigger: string;
  protocolReady: boolean;
  launchMode: LaunchMode;
  pairedDevices: Array<{ id: string; name: string; os: string }>;
  lastView: GodsEyeViewOutput | null;
  serverReady: boolean;
  serverError: string | null;
  mapboxReady: boolean;
  actions: {
    open(input: GodsEyeViewInput): Promise<GodsEyeViewOutput>;
    sync(afterSequence: number): Promise<{
      commands: GodsEyeViewCommandEnvelope[];
      lastView: GodsEyeViewOutput | null;
      serverReady: boolean;
      serverError: string | null;
    }>;
  };
}

export interface ProtocolMemory {
  remember?(entry: {
    id: string;
    kind: "procedural";
    content: string;
    createdAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  upsertNode?(node: {
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
    kind: "procedural";
    metadata: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface UrlOpenResult {
  opened: boolean;
  deviceId?: string | null;
  message?: string;
}

export interface GodsEyeViewCapabilityOptions
  extends Pick<
    SshCapabilityOptions,
    | "devices"
    | "host"
    | "user"
    | "port"
    | "privateKey"
    | "privateKeyPath"
    | "ssh"
    | "timeoutMs"
    | "maxOutputBytes"
  > {
  env: Environment;
  memory?: ProtocolMemory;
  baseUrl?: string;
  repositoryUrl?: string;
  protocolTrigger?: string;
  defaultDeviceId?: string;
  geocoderUrl?: string;
  launchMode?: string;
  bundledServer?: boolean | string;
  googleMapsApiKey?: string;
  cesiumIonToken?: string;
  mapboxAccessToken?: string;
  mapboxStyle?: string;
  openAiApiKey?: string;
  fetch?: typeof fetch;
  urlOpener?: (url: string, deviceId: string | null) => Promise<UrlOpenResult>;
}

type LaunchMode = "auto" | "ssh" | "local" | "link";

const REPOSITORY_URL = "https://github.com/bilawalsidhu/gods-eye-view";
const DEFAULT_BASE_URL = "http://localhost:4173";
const DEFAULT_GEOCODER_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_ALTITUDE_METERS = 18_000;
const DEFAULT_MAPBOX_STYLE = "mapbox/standard-satellite";

const ACTION_NAMES = [
  "fly_to_location", "select_nearest_aircraft", "adjust_camera_zoom", "zoom_to_globe",
  "set_layer_visibility", "show_data_layers_menu", "set_panel_open", "set_context_mode",
  "control_cockpit", "set_visual_style", "get_entity_context", "get_current_view_state",
  "set_hud", "set_detection", "set_map_stack", "set_post_processing", "control_scene",
  "control_cctv", "control_radio", "track_entity", "stop_tracking", "frame_overhead",
  "annotate_map", "clear_annotations", "move_camera", "fly_route", "analyst_query",
  "next_iss_pass",
] as const;

const LAYER_TOKENS: Record<GodsEyeViewLayer, string> = {
  cameras: "c",
  flights: "f",
  vessels: "a",
  satellites: "s",
  earthquakes: "e",
  traffic: "t",
  radio: "r",
  all: "a.c.e.f.m.r.s.t",
};

const KNOWN_LOCATIONS: Record<string, GodsEyeCoordinates> = {
  treviso: { latitude: 45.6669, longitude: 12.243 },
  london: { latitude: 51.5072, longitude: -0.1276 },
  austin: { latitude: 30.2672, longitude: -97.7431 },
  helsinki: { latitude: 60.1699, longitude: 24.9384 },
  calgary: { latitude: 51.0447, longitude: -114.0719 },
};

const CCTV_COVERAGE_HINTS = [
  "austin",
  "texas",
  "california",
  "london",
  "ontario",
  "finland",
  "helsinki",
  "british columbia",
  "estonia",
  "tallinn",
  "new south wales",
  "calgary",
];

const DOCS = `# open_gods_eye_view

Opens and drives the bundled God's Eye View 3D globe (Mapbox): centers on a geocoded place, switches live layers (CCTV cameras, flights, vessels, satellites, earthquakes, traffic, radio) and basemap, and forwards any of the app's native AI actions. The view shows in the PLAIOS webview and, by default, also opens in the browser of the paired Mac.

## When to use
- The user says "occhio di dio" or asks to see, find or track cameras/CCTV, aircraft, ships, satellites, earthquakes, traffic or a place on the globe.
- Not for Home Assistant cameras at home (use the Home Assistant \`HomeCameras\` component) or for general map/route questions you can answer in text.

## Inputs
Always pass the user's full request in \`query\`; set \`location\` and \`layer\` when stated, otherwise null (they are inferred from \`query\`).
- \`{"query": "Fammi vedere le telecamere a Treviso", "location": "Treviso", "layer": "cameras", "deviceId": null}\`
- \`{"query": "aerei sopra Milano", "location": "Milano", "layer": "flights", "deviceId": null, "openOnMac": false}\`
- \`{"query": "zoom out to the whole globe", "location": null, "layer": null, "deviceId": null, "actionName": "zoom_to_globe", "actionArguments": {}}\`

## Limits and failures
- Call timeout 25s; geocoding and the remote open use a 15s timeout. \`GEOCODING_FAILED\` is retryable, \`LOCATION_NOT_FOUND\` is not: ask for a clearer place.
- The public CCTV catalog covers only some areas: relay \`coverageNotice\` when present instead of claiming there are no cameras.
- Opening on the Mac goes over SSH to a paired device; if that fails the view still loads in the webview (\`opened: false\`). Some layers are still migration placeholders and may show no data.
`;

const manifest: CapabilityManifest = {
  id: "gods-eye-view.open",
  version: "2.0.0",
  name: "open_gods_eye_view",
  description:
    "Controls the complete bundled God's Eye View intelligence globe. Use it whenever the user says 'occhio di dio' or asks to view, find, track, annotate, or analyze cameras/CCTV, aircraft, vessels, satellites, earthquakes, traffic, radio, transit, fires, infrastructure, or a place. It opens the local webview and can forward any of the app's 28 native AI actions.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The user's complete request, preserving any requested place or layer.",
      },
      location: {
        type: ["string", "null"],
        description: "Place to center the globe on, such as Treviso, or null if none was requested.",
      },
      layer: {
        type: ["string", "null"],
        enum: [
          "cameras",
          "flights",
          "vessels",
          "satellites",
          "earthquakes",
          "traffic",
          "radio",
          "all",
          null,
        ],
        description: "The live layer to show, or null to preserve the app's current/default layers.",
      },
      deviceId: {
        type: ["string", "null"],
        description: "Paired Mac id/name, or null to use the configured default.",
      },
      actionName: {
        type: ["string", "null"],
        enum: [...ACTION_NAMES, null],
        description: "Optional native God's Eye View AI action. Use for advanced globe control beyond location and layer selection.",
      },
      actionArguments: {
        type: ["object", "null"],
        description: "Arguments for actionName, following the native God's Eye View action schema.",
        additionalProperties: true,
      },
      mapStack: {
        type: ["string", "null"],
        enum: ["photoreal", "bing-aerial", "bing-labels", "esri-imagery", "mapbox", "osm", null],
        description: "Optional basemap. Mapbox is available when a token is configured.",
      },
      openOnMac: {
        type: ["boolean", "null"],
        description: "Whether to also open the live view in the Mac browser. Defaults to true for AI calls.",
      },
    },
    required: ["query", "location", "layer", "deviceId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      location: { type: ["string", "null"] },
      coordinates: {
        type: ["object", "null"],
        properties: {
          latitude: { type: "number" },
          longitude: { type: "number" },
        },
        required: ["latitude", "longitude"],
        additionalProperties: false,
      },
      layer: { type: ["string", "null"] },
      opened: { type: "boolean" },
      deviceId: { type: ["string", "null"] },
      coverageNotice: { type: ["string", "null"] },
      summary: { type: "string" },
      commandSequence: { type: "number" },
    },
    required: [
      "url",
      "location",
      "coordinates",
      "layer",
      "opened",
      "deviceId",
      "coverageNotice",
      "summary",
      "commandSequence",
    ],
    additionalProperties: false,
  },
  permissions: ["network.http", "network.ssh", "remote.control"],
  tags: [
    "occhio-di-dio",
    "gods-eye-view",
    "webview",
    "macos",
    "map",
    "globe",
    "cameras",
    "cctv",
    "flights",
    "vessels",
    "satellites",
    "earthquakes",
    "traffic",
    "radio",
  ],
  execution: { timeoutMs: 25_000, idempotent: false },
  examples: [
    {
      request: "Give me all the cameras at Treviso",
      arguments: {
        query: "Give me all the cameras at Treviso",
        location: "Treviso",
        layer: "cameras",
        deviceId: null,
      },
    },
    {
      request: "Apri occhio di dio su Londra",
      arguments: {
        query: "Apri occhio di dio su Londra",
        location: "Londra",
        layer: null,
        deviceId: null,
      },
    },
  ],
};

export class GodsEyeViewCapability
  implements Capability<GodsEyeViewInput, GodsEyeViewOutput>
{
  readonly manifest = manifest;

  private readonly baseUrl: string;
  private readonly repositoryUrl: string;
  private readonly protocolTrigger: string;
  private readonly defaultDeviceId: string | undefined;
  private readonly geocoderUrl: string;
  private readonly launchMode: LaunchMode;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly remote: SshCapability;
  private readonly urlOpener: GodsEyeViewCapabilityOptions["urlOpener"];
  private readonly protocolReady: Promise<boolean>;
  private readonly bundledServer: BundledGodsEyeViewServer | null;
  private readonly mapboxAccessToken: string | undefined;
  private serverReady = false;
  private serverError: string | null = null;
  private sequence = 0;
  private readonly commandQueue: GodsEyeViewCommandEnvelope[] = [];
  private lastView: GodsEyeViewOutput | null = null;

  constructor(options: GodsEyeViewCapabilityOptions) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? options.env.get("GODS_EYE_VIEW_URL") ?? DEFAULT_BASE_URL,
    );
    this.repositoryUrl = options.repositoryUrl ?? REPOSITORY_URL;
    this.protocolTrigger = (options.protocolTrigger ?? "occhio di dio").trim();
    this.defaultDeviceId = cleanOptional(options.defaultDeviceId);
    this.geocoderUrl = parseHttpUrl(options.geocoderUrl ?? DEFAULT_GEOCODER_URL, "Geocoder").href;
    this.launchMode = normalizeLaunchMode(options.launchMode);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(1_000, Math.trunc(options.timeoutMs ?? 15_000));
    this.urlOpener = options.urlOpener;
    this.mapboxAccessToken = cleanOptional(
      options.mapboxAccessToken ?? options.env.get("MAPBOX_ACCESS_TOKEN"),
    );
    const shouldBundle = normalizeBoolean(options.bundledServer, true) &&
      !options.urlOpener && this.launchMode !== "link" && isLoopbackUrl(this.baseUrl);
    this.bundledServer = shouldBundle
      ? new BundledGodsEyeViewServer({
          baseUrl: this.baseUrl,
          googleMapsApiKey: cleanOptional(options.googleMapsApiKey ?? options.env.get("GOOGLE_MAPS_API_KEY")),
          cesiumIonToken: cleanOptional(options.cesiumIonToken ?? options.env.get("CESIUM_ION_TOKEN")),
          mapboxAccessToken: this.mapboxAccessToken,
          mapboxStyle: cleanOptional(options.mapboxStyle ?? options.env.get("MAPBOX_STYLE")) ?? DEFAULT_MAPBOX_STYLE,
          openAiApiKey: cleanOptional(options.openAiApiKey ?? options.env.get("OPENAI_API_KEY")),
        })
      : null;
    this.remote = new SshCapability(options);
    this.protocolReady = rememberProtocol(options.memory, this.protocolTrigger)
      .then(() => Boolean(this.protocolTrigger))
      .catch(() => false);
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  async microfrontendData(): Promise<GodsEyeViewDashboard> {
    await this.ensureBundledApp();
    const protocolReady = await this.protocolReady;
    return {
      baseUrl: this.baseUrl,
      repositoryUrl: this.repositoryUrl,
      protocolTrigger: this.protocolTrigger,
      protocolReady,
      launchMode: this.launchMode,
      pairedDevices: this.remote.listDevices().map((device) => ({
        id: device.id,
        name: device.name,
        os: device.os,
      })),
      lastView: this.lastView,
      serverReady: this.serverReady || this.bundledServer === null,
      serverError: this.serverError,
      mapboxReady: Boolean(this.mapboxAccessToken),
      actions: {
        open: async (input) => {
          const result = await this.execute(input, {
            runId: "ui",
            callId: "ui",
            startedAt: new Date(),
          });
          if (!result.success) throw new Error(result.error.message);
          return result.data;
        },
        sync: async (afterSequence) => ({
          commands: this.commandQueue.filter((item) => item.sequence > afterSequence),
          lastView: this.lastView,
          serverReady: this.serverReady || this.bundledServer === null,
          serverError: this.serverError,
        }),
      },
    };
  }

  async execute(
    input: GodsEyeViewInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<GodsEyeViewOutput>> {
    const query = input.query?.trim() ?? "";
    await this.ensureBundledApp();
    const requestedLocation = cleanOptional(input.location) ?? inferLocation(query);
    const layer = input.layer ?? inferLayer(query);
    const mapStack = input.mapStack ?? inferMapStack(query);

    let resolved: ResolvedLocation | null = null;
    if (requestedLocation) {
      try {
        resolved = await this.geocode(requestedLocation, context.signal);
      } catch (error) {
        return failure(
          "GEOCODING_FAILED",
          error instanceof Error ? error.message : String(error),
          true,
        );
      }
      if (!resolved) {
        return failure(
          "LOCATION_NOT_FOUND",
          `I could not find a map location for "${requestedLocation}".`,
          false,
        );
      }
    }

    const url = buildGodsEyeViewUrl({
      baseUrl: this.baseUrl,
      coordinates: resolved,
      layer,
      mapStack,
    });
    const targetDevice = cleanOptional(input.deviceId) ?? this.defaultDeviceId ?? null;
    const launch = input.openOnMac === false
      ? { opened: false, deviceId: targetDevice, message: "Loaded in the PLAIOS webview." }
      : await this.openUrl(url, targetDevice, context);
    const coverageNotice = cameraCoverageNotice(layer, requestedLocation, resolved?.displayName);
    const locationLabel = resolved?.displayName ?? requestedLocation ?? null;
    const summary = summarizeOpen({
      opened: launch.opened,
      location: locationLabel,
      layer,
      coverageNotice,
      launchMessage: launch.message,
      url,
    });
    const commands = buildCommands({
      coordinates: resolved,
      layer,
      mapStack,
      actionName: input.actionName,
      actionArguments: input.actionArguments,
      query,
    });
    const commandSequence = ++this.sequence;
    this.commandQueue.push({
      sequence: commandSequence,
      query,
      commands,
      url,
      createdAt: new Date().toISOString(),
    });
    if (this.commandQueue.length > 64) this.commandQueue.splice(0, this.commandQueue.length - 64);
    const output: GodsEyeViewOutput = {
      url,
      location: locationLabel,
      coordinates: resolved
        ? { latitude: resolved.latitude, longitude: resolved.longitude }
        : null,
      layer,
      opened: launch.opened,
      deviceId: launch.deviceId ?? targetDevice,
      coverageNotice,
      summary,
      commandSequence,
    };
    this.lastView = output;
    return { success: true, data: output };
  }

  async close(): Promise<void> {
    await this.bundledServer?.close();
  }

  private async ensureBundledApp(): Promise<void> {
    if (!this.bundledServer || this.serverReady) return;
    try {
      await this.bundledServer.ensureStarted();
      this.serverReady = true;
      this.serverError = null;
    } catch (error) {
      this.serverError = error instanceof Error ? error.message : String(error);
    }
  }

  private async geocode(
    location: string,
    signal?: AbortSignal,
  ): Promise<ResolvedLocation | null> {
    const known = knownLocation(location);
    if (known) return { ...known, displayName: location };

    const endpoint = new URL(this.geocoderUrl);
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("q", location);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetcher(endpoint, {
      headers: {
        accept: "application/json",
        "accept-language": "it,en;q=0.8",
        "user-agent": "AgentOS-GodsEyeView/0.1",
      },
      signal: requestSignal,
    });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const body = await response.json() as unknown;
    if (!Array.isArray(body) || body.length === 0 || !isRecord(body[0])) return null;
    const latitude = Number(body[0].lat);
    const longitude = Number(body[0].lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      displayName:
        typeof body[0].display_name === "string" && body[0].display_name.trim()
          ? body[0].display_name.trim()
          : location,
    };
  }

  private async openUrl(
    url: string,
    deviceId: string | null,
    context: CapabilityExecutionContext,
  ): Promise<UrlOpenResult> {
    if (this.urlOpener) return this.urlOpener(url, deviceId);
    if (this.launchMode === "link") {
      return { opened: false, deviceId, message: "The view link is ready." };
    }

    const devices = this.remote.listDevices();
    if ((this.launchMode === "auto" || this.launchMode === "ssh") && devices.length > 0) {
      const remoteResult = await this.remote.execute(
        {
          deviceId,
          action: "open_url",
          command: url,
          text: url,
        },
        context,
      );
      if (!remoteResult.success) {
        return {
          opened: false,
          deviceId,
          message: remoteResult.error.message,
        };
      }
      return {
        opened: true,
        deviceId: remoteResult.data.deviceId,
        message: remoteResult.data.summary,
      };
    }

    if ((this.launchMode === "auto" || this.launchMode === "local") && process.platform === "darwin") {
      await openOnLocalMac(url);
      return { opened: true, deviceId: "local-mac", message: "Opened on this Mac." };
    }

    return {
      opened: false,
      deviceId,
      message:
        this.launchMode === "ssh"
          ? "No paired Mac is configured for SSH opening."
          : "The view link is ready; open it from the action webview.",
    };
  }
}

interface ResolvedLocation extends GodsEyeCoordinates {
  displayName: string;
}

export function buildGodsEyeViewUrl({
  baseUrl,
  coordinates,
  layer,
  mapStack,
}: {
  baseUrl: string;
  coordinates?: GodsEyeCoordinates | null;
  layer?: GodsEyeViewLayer | null;
  mapStack?: GodsEyeViewInput["mapStack"];
}): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.searchParams.set("agent_os", "1");
  if (!coordinates && !layer && !mapStack) return url.href;
  const params = new URLSearchParams();
  params.set("v", "2");
  if (coordinates) {
    params.set("lat", coordinates.latitude.toFixed(4));
    params.set("lon", coordinates.longitude.toFixed(4));
    params.set("alt", String(DEFAULT_ALTITUDE_METERS));
    params.set("heading", "0");
    params.set("pitch", "-45");
    params.set("roll", "0");
  }
  params.set("style", "normal");
  params.set("bloom", "0");
  params.set("sharpen", "0");
  params.set("hud", "tactical");
  params.set("hv", "1");
  params.set("dm", "BALANCED");
  params.set("dd", "50");
  params.set("map", mapStack ?? "photoreal");
  if (layer) params.set("l", LAYER_TOKENS[layer]);
  url.hash = params.toString();
  return url.href;
}

function buildCommands({
  coordinates,
  layer,
  mapStack,
  actionName,
  actionArguments,
  query,
}: {
  coordinates: GodsEyeCoordinates | null;
  layer: GodsEyeViewLayer | null;
  mapStack?: GodsEyeViewInput["mapStack"];
  actionName?: GodsEyeViewActionName | null;
  actionArguments?: Record<string, unknown> | null;
  query: string;
}): GodsEyeViewCommand[] {
  const commands: GodsEyeViewCommand[] = [];
  if (coordinates) {
    commands.push({
      name: "fly_to_location",
      arguments: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        viewMode: "overview",
        rangeM: DEFAULT_ALTITUDE_METERS,
        waitForArrival: false,
      },
    });
  }
  for (const layerId of layerIds(layer)) {
    commands.push({
      name: "set_layer_visibility",
      arguments: { layerId, enabled: true },
    });
  }
  if (mapStack) {
    commands.push({ name: "set_map_stack", arguments: { stack: mapStack } });
  }
  if (actionName) {
    commands.push({ name: actionName, arguments: actionArguments ?? {} });
  } else {
    const inferred = inferNativeCommand(query);
    if (inferred && !(inferred.name === "set_map_stack" && mapStack)) commands.push(inferred);
  }
  return commands;
}

function layerIds(layer: GodsEyeViewLayer | null): string[] {
  const ids: Record<Exclude<GodsEyeViewLayer, "all">, string> = {
    cameras: "cctv",
    flights: "flights",
    vessels: "ais-live-vessels",
    satellites: "satellites",
    earthquakes: "earthquakes",
    traffic: "traffic",
    radio: "radio",
  };
  if (!layer) return [];
  if (layer !== "all") return [ids[layer]];
  return [
    "flights", "military", "earthquakes", "satellites", "rocket-launches",
    "traffic", "cctv", "radio", "bikeshare", "ais-live-vessels",
    "local-datacenters", "local-dams", "telegeography-submarine-cables",
    "local-firms", "alpr-cameras",
  ];
}

export function inferLayer(text: string): GodsEyeViewLayer | null {
  if (/\b(camera|cameras|cctv|webcam|telecamera|telecamere)\b/i.test(text)) return "cameras";
  if (/\b(flight|flights|aircraft|plane|planes|voli|aerei)\b/i.test(text)) return "flights";
  if (/\b(ship|ships|vessel|vessels|navi|imbarcazioni)\b/i.test(text)) return "vessels";
  if (/\b(satellite|satellites|satelliti)\b/i.test(text)) return "satellites";
  if (/\b(earthquake|earthquakes|terremoti|sisma)\b/i.test(text)) return "earthquakes";
  if (/\b(traffic|traffico)\b/i.test(text)) return "traffic";
  if (/\b(radio|station|stazione)\b/i.test(text)) return "radio";
  return null;
}

export function inferMapStack(text: string): GodsEyeViewInput["mapStack"] {
  if (/\bmapbox\b/i.test(text)) return "mapbox";
  if (/\b(?:open\s*street\s*map|osm|road map)\b/i.test(text)) return "osm";
  if (/\besri\b/i.test(text)) return "esri-imagery";
  if (/\bbing\b.*\blabel/i.test(text)) return "bing-labels";
  if (/\bbing\b/i.test(text)) return "bing-aerial";
  if (/\b(?:google 3d|photoreal(?:istic)?)\b/i.test(text)) return "photoreal";
  return null;
}

function inferNativeCommand(text: string): GodsEyeViewCommand | null {
  const style = /\b(thermal|retro|surveillance|anime|noir|snow|normal)\b/i.exec(text)?.[1]?.toLowerCase();
  if (style) return { name: "set_visual_style", arguments: { style } };
  if (/\bzoom\s+(?:all\s+the\s+way\s+)?in\b/i.test(text)) {
    return { name: "adjust_camera_zoom", arguments: { direction: "in", amount: "medium" } };
  }
  if (/\bzoom\s+(?:all\s+the\s+way\s+)?out\b/i.test(text)) {
    return { name: "adjust_camera_zoom", arguments: { direction: "out", amount: "medium" } };
  }
  if (/\b(?:whole|full)\s+(?:earth|globe)|zoom to globe\b/i.test(text)) {
    return { name: "zoom_to_globe", arguments: {} };
  }
  if (/\bhide\s+(?:the\s+)?hud\b/i.test(text)) {
    return { name: "set_hud", arguments: { visible: false } };
  }
  if (/\bshow\s+(?:the\s+)?hud\b/i.test(text)) {
    return { name: "set_hud", arguments: { visible: true } };
  }
  return null;
}

export function inferLocation(text: string): string | undefined {
  const patterns = [
    /\b(?:at|in|near|around|over)\s+([^?.!,]+?)(?:\s+(?:on|with|showing)\b|[?.!,]|$)/i,
    /\b(?:ad|a|su|vicino a|intorno a|sopra)\s+([^?.!,]+?)(?:\s+(?:con|mostrando)\b|[?.!,]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const candidate = match?.[1]?.trim();
    if (candidate && !/^(?:the|il|lo|la|un|una)$/i.test(candidate)) return candidate;
  }
  return undefined;
}

async function rememberProtocol(
  memory: ProtocolMemory | undefined,
  trigger: string,
): Promise<void> {
  if (!memory || !trigger) return;
  const expansion =
    "Use God's Eye View to handle the current geospatial request and open the resulting webview on the Mac";
  const metadata = {
    namespace: "protocol",
    trigger,
    expansion,
    instruction: expansion,
    device: "mac",
    capabilityId: manifest.id,
  };
  if (typeof memory.upsertNode === "function") {
    await memory.upsertNode({
      id: "",
      type: "protocol",
      label: trigger,
      data: { ...metadata },
      kind: "procedural",
      metadata,
    });
  }
  if (typeof memory.remember === "function") {
    await memory.remember({
      id: `protocol:${slug(trigger)}`,
      kind: "procedural",
      content: `When the user says "${trigger}", ${expansion}.`,
      createdAt: new Date(),
      metadata,
    });
  }
}

function summarizeOpen({
  opened,
  location,
  layer,
  coverageNotice,
  launchMessage,
  url,
}: {
  opened: boolean;
  location: string | null;
  layer: GodsEyeViewLayer | null;
  coverageNotice: string | null;
  launchMessage?: string;
  url: string;
}): string {
  const view = `${layer === "cameras" ? "public cameras" : layer ?? "globe"}${location ? ` at ${location}` : ""}`;
  const status = opened ? `Opened God's Eye View (${view}) on the Mac.` : `Prepared God's Eye View (${view}): ${url}`;
  return [status, coverageNotice, !opened ? launchMessage : undefined].filter(Boolean).join(" ");
}

function cameraCoverageNotice(
  layer: GodsEyeViewLayer | null,
  requestedLocation?: string,
  displayName?: string,
): string | null {
  if (layer !== "cameras") return null;
  const place = `${requestedLocation ?? ""} ${displayName ?? ""}`.toLowerCase();
  if (CCTV_COVERAGE_HINTS.some((hint) => place.includes(hint))) return null;
  return "The upstream public-camera catalog does not currently list this area, so the CCTV layer may be empty there.";
}

function knownLocation(value: string): GodsEyeCoordinates | undefined {
  return KNOWN_LOCATIONS[foldAccents(value).trim()];
}

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function parseHttpUrl(value: string, label: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} URL must use http or https`);
  }
  return url;
}

function normalizeBaseUrl(value: string): string {
  const url = parseHttpUrl(value, "God's Eye View");
  url.hash = "";
  return url.href;
}

function normalizeLaunchMode(value?: string): LaunchMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "ssh" || normalized === "local" || normalized === "link"
    ? normalized
    : "auto";
}

function normalizeBoolean(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function cleanOptional(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function slug(value: string): string {
  return foldAccents(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gods-eye-view";
}

async function openOnLocalMac(url: string): Promise<void> {
  await promisify(execFile)("/usr/bin/open", [url], { timeout: 10_000 });
}

function failure(
  code: string,
  message: string,
  retryable: boolean,
): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
