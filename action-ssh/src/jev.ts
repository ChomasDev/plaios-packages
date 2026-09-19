import { choice, noul, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
} from "@agent-os/core/domain";

import { SshCapability, type SshCapabilityOptions, type SshControlOutput } from "./capability.js";
import type { RemoteAction } from "./commands.js";
import { findDevice, publicDevices } from "./devices.js";
import {
  extractUrl,
  findMatchingProtocol,
  isRemoteInstruction,
  parseProtocolRemember,
  protocolConfirmation,
  saveProtocol,
  type ProtocolMemory,
} from "./protocol.js";

export interface SshJevInput {
  text: string;
  history?: Array<{ role: string; content: string }>;
}

export interface SshJevOutput {
  deviceId: string | null;
  action: RemoteAction | "none";
  devices: SshControlOutput["devices"];
  stdout: string;
  stderr: string;
  summary: string;
  localPath?: string;
}

export interface SshJevCapabilityOptions extends SshCapabilityOptions {
  apiKey?: string;
  typesafeFetch?: Fetch;
  memory?: ProtocolMemory;
}

const DEVICE_THRESHOLD = 0.5;
const ACTIONS = {
  list: "List paired computers",
  status: "Report hostname, user, uptime, or whether the computer is reachable",
  exec: "Run a shell command on the computer",
  open_app: "Open a macOS application",
  open_url: "Open a URL in the default browser on the computer",
  quit_app: "Quit a macOS application",
  notify: "Show a notification on the computer",
  lock: "Lock the screen or sleep the display",
  sleep_display: "Turn the display off",
  wake_display: "Wake the display",
  set_volume: "Set system volume to a percentage",
  speak: "Speak text out loud",
  screenshot: "Capture a screenshot",
  osascript: "Run AppleScript",
  none: "Not a remote-computer command",
} as const;

const manifest: CapabilityManifest = {
  id: "ssh.jev",
  version: "1.0.0",
  name: "control_remote_computer_jev",
  description:
    "Takes a natural-language request and controls a paired Mac or Linux computer over SSH. Examples: open Safari on the Mac, open http://100.103.217.8:3100 on the Mac, lock the studio Mac, what's on that computer, set the volume to 20, run ls on thomas-mac.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The user's remote-computer request." },
      history: {
        type: "array",
        items: {
          type: "object",
          properties: { role: { type: "string" }, content: { type: "string" } },
        },
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      deviceId: { type: ["string", "null"] },
      action: { type: "string" },
      devices: { type: "array" },
      stdout: { type: "string" },
      stderr: { type: "string" },
      summary: { type: "string" },
      localPath: { type: "string" },
    },
    required: ["deviceId", "action", "devices", "stdout", "stderr", "summary"],
    additionalProperties: false,
  },
  permissions: ["network.ssh", "remote.control"],
  tags: [
    "direct",
    "ssh",
    "macos",
    "mac",
    "computer",
    "remote",
    "safari",
    "apri",
    "chiudi",
    "schermo",
    "volume",
    "screenshot",
  ],
  execution: { timeoutMs: 25_000, idempotent: false },
  examples: [
    { request: "Apri Safari sul Mac", arguments: { text: "Apri Safari sul Mac" } },
    { request: "Lock the studio computer", arguments: { text: "Lock the studio computer" } },
  ],
};

export class SshJevCapability implements Capability<SshJevInput, SshJevOutput> {
  readonly manifest = manifest;
  private readonly control: SshCapability;
  private readonly memory: ProtocolMemory | undefined;
  private readonly apiKey: string | undefined;
  private readonly typesafeFetch: Fetch | undefined;
  private client: TypeSafeClient | undefined;

  constructor(options: SshJevCapabilityOptions) {
    this.control = new SshCapability(options);
    this.memory = options.memory;
    this.apiKey = options.apiKey ?? options.env.get("JEV_API_KEY") ?? options.env.get("TYPESAFE_API_KEY");
    this.typesafeFetch = options.typesafeFetch;
  }

  microfrontendData() {
    return this.control.microfrontendData();
  }

  async execute(
    input: SshJevInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<SshJevOutput>> {
    const incoming = input.text?.trim() ?? "";
    if (!incoming) return failure("VALIDATION_ERROR", "A remote-computer request is required");

    const remembered = parseProtocolRemember(incoming);
    if (remembered) {
      await saveProtocol(this.memory, context.userId, remembered);
      return success({
        deviceId: null,
        action: "none",
        devices: publicDevices(this.control.listDevices()),
        stdout: "",
        stderr: "",
        summary: protocolConfirmation(remembered),
      });
    }

    const matched = await findMatchingProtocol(this.memory, context.userId, incoming);
    const text = matched?.expansion ?? incoming;
    if (matched && !isRemoteInstruction(text)) {
      return success({
        deviceId: null,
        action: "none",
        devices: publicDevices(this.control.listDevices()),
        stdout: "",
        stderr: "",
        summary: "",
      });
    }
    const devices = this.control.listDevices();
    if (devices.length === 0) {
      return success({
        deviceId: null,
        action: "none",
        devices: [],
        stdout: "",
        stderr: "",
        summary: "Nessun computer è abbinato. Aggiungi host, utente e chiave SSH, poi installa Agent OS Remote sul Mac.",
      });
    }

    const history = compactTurns(input.history);
    const directUrl = extractUrl(text);
    if (directUrl && /\b(apri|open|agentos|http)\b/i.test(text)) {
      const device = devices.length === 1 ? devices[0] : findDevice(devices, namedDevice(text)) ?? devices[0];
      if (!device) {
        return success({
          deviceId: null,
          action: "open_url",
          devices: publicDevices(devices),
          stdout: "",
          stderr: "",
          summary: isItalian(text)
            ? `Quale computer? Ho: ${devices.map((item) => item.name).join(", ")}.`
            : `Which computer? I have: ${devices.map((item) => item.name).join(", ")}.`,
        });
      }
      return this.control.execute(
        { deviceId: device.id, action: "open_url", command: directUrl, text: directUrl },
        context,
      ) as Promise<CapabilityResult<SshJevOutput>>;
    }

    let answers: Record<string, { type?: string; choice?: string; noul?: number }>;
    try {
      const response = await this.getClient().systemOne(
        {
          state: {
            text,
            history,
            devices: publicDevices(devices).map((device) => ({
              id: device.id,
              name: device.name,
              host: device.host,
              user: device.user,
              port: device.port,
              os: device.os,
            })),
          },
          questions: {
            action: choice(
              "What remote-computer action should be taken for `text`? Use `history` for follow-ups. Prefer `none` if this is not about controlling a paired computer.",
              ACTIONS,
            ),
            ...Object.fromEntries(
              devices.map((device) => [
                deviceQuestionId(device.id),
                noul(
                  `Does \`text\` (or \`history\`) target the computer "${device.name}" (${device.user}@${device.host}, ${device.os})?`,
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

    const action = selectedAction(answers.action?.choice);
    if (action === "none") {
      return success({
        deviceId: null,
        action: "none",
        devices: publicDevices(devices),
        stdout: "",
        stderr: "",
        summary: isItalian(text)
          ? "Non mi sembra un comando per un computer remoto."
          : "That doesn't look like a remote-computer command.",
      });
    }

    const ranked = devices
      .map((device) => ({ device, noul: noulOf(answers, deviceQuestionId(device.id)) }))
      .filter((item) => item.noul >= DEVICE_THRESHOLD)
      .sort((left, right) => right.noul - left.noul);
    const device = ranked[0]?.device ?? (devices.length === 1 ? devices[0] : findDevice(devices, namedDevice(text)));
    if (!device && action !== "list") {
      return success({
        deviceId: null,
        action,
        devices: publicDevices(devices),
        stdout: "",
        stderr: "",
        summary: isItalian(text)
          ? `Quale computer? Ho: ${devices.map((item) => item.name).join(", ")}.`
          : `Which computer? I have: ${devices.map((item) => item.name).join(", ")}.`,
      });
    }

    return this.control.execute(
      {
        deviceId: device?.id ?? null,
        action,
        command: action === "open_url" ? extractUrl(text) ?? extractCommand(text, action) : extractCommand(text, action),
        app: extractApp(text, action),
        text: action === "open_url" ? extractUrl(text) ?? text : extractSpeech(text, action),
        value: extractVolume(text),
      },
      context,
    ) as Promise<CapabilityResult<SshJevOutput>>;
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

function selectedAction(value?: string): RemoteAction | "none" {
  return value && value in ACTIONS ? (value as RemoteAction | "none") : "none";
}

function deviceQuestionId(id: string): string {
  return `dev:${id}`;
}

function noulOf(answers: Record<string, { type?: string; noul?: number }>, key: string): number {
  const answer = answers[key];
  return answer?.type === "noul" && typeof answer.noul === "number" ? answer.noul : 0;
}

function compactTurns(
  value: SshJevInput["history"],
): Array<{ role: string; content: string }> {
  return (value ?? []).flatMap((entry) => {
    const role = entry?.role?.trim();
    const content = entry?.content?.trim();
    return role && content ? [{ role, content }] : [];
  }).slice(-10);
}

function namedDevice(text: string): string | undefined {
  const match = text.match(/\b(?:on|sul|sulla|sullo)\s+(?:the\s+)?([a-z0-9._-]+)/i);
  return match?.[1];
}

function extractApp(text: string, action: RemoteAction | "none"): string | null {
  if (action !== "open_app" && action !== "quit_app") return null;
  const match = text.match(/\b(?:open|apri|quit|chiudi|chiude)\s+(.+?)(?:\s+(?:on|sul|sulla|sullo)\s+.+)?$/i);
  return match?.[1]?.replace(/\s+(the\s+)?(mac|computer|pc)\s*$/i, "").trim() ?? null;
}

function extractCommand(text: string, action: RemoteAction | "none"): string | null {
  if (action !== "exec" && action !== "osascript") return null;
  const match = text.match(/\b(?:run|esegui|exec)\s+(.+)$/i);
  return match?.[1]?.trim() ?? text;
}

function extractSpeech(text: string, action: RemoteAction | "none"): string | null {
  if (action === "notify" || action === "speak") {
    const match = text.match(/\b(?:say|dici|notifica|notify)\s+(.+)$/i);
    return match?.[1]?.trim() ?? text;
  }
  return null;
}

function extractVolume(text: string): number | null {
  const match = text.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function isItalian(text: string): boolean {
  return /\b(apri|chiudi|sul|sulla|mac|computer|schermo|volume|blocca|esegui|ricorda|protocollo)\b/i.test(text);
}

function success(data: SshJevOutput): CapabilityResult<SshJevOutput> {
  return { success: true, data };
}

function failure(code: string, message: string, retryable = false): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
