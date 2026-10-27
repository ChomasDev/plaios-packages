import {
  choice,
  compactTurns,
  extractUrl,
  findMatchingProtocol,
  isRemoteInstruction,
  noul,
  noulOf,
  parseProtocolRemember,
  protocolConfirmation,
  saveProtocol,
  type ProtocolMemory,
} from "@plaios/systems";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  System1,
  System2,
  SystemAnswers,
  SystemQuestions,
} from "@plaios/core/domain";

import {
  SshCapability,
  errorMessage,
  failure,
  type SshCapabilityOptions,
  type SshControlOutput,
} from "./capability.js";
import type { RemoteAction } from "./commands.js";
import { findDevice, publicDevices, type RemoteDevice } from "./devices.js";

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
  system1?: System1;
  system2?: System2;
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

const DOCS = `# control_remote_computer_jev

Takes the user's natural-language request about a paired Mac or Linux computer and runs it over SSH. System 1 (Jev) picks the action and the device (System 2 when System 1 is missing or fails); it then calls the same commands as \`control_remote_computer\`.

## When to use
- Default for remote-computer requests phrased by the user: "apri Safari sul Mac", "blocca il Mac dello studio", "volume al 20%", "open https://example.com on the Mac".
- Also saves and replays user protocols ("ricorda che ..."): pass that text as-is.
- Prefer \`control_remote_computer\` when you need an exact shell command, AppleScript or a specific device id that the text does not express well.
- Not for Home Assistant devices or for the Agent OS server itself.

## Inputs
- \`{"text": "Apri Safari sul Mac"}\`
- \`{"text": "e chiudilo", "history": [{"role": "user", "content": "Apri Safari sul Mac"}]}\` for follow-ups.
Pass the user's words, not a rewritten command. A URL plus "apri/open" opens it directly on the (single or named) computer.

## Limits and failures
- Call timeout 25s. With several computers and no clear target it returns \`action\` set and a "Which computer?" \`summary\` without running anything: relay the question.
- \`action: "none"\` means the text was not a remote-computer command: answer normally or use another capability.
- \`JEV_REQUEST_FAILED\` (retryable) when neither System 1 nor System 2 answered; SSH errors are the same as \`control_remote_computer\`.
- No confirmation step: shell commands run immediately. Confirm destructive requests with the user before calling.
`;

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
  private readonly system1: System1 | undefined;
  private readonly system2: System2 | undefined;

  constructor(options: SshJevCapabilityOptions) {
    this.control = new SshCapability(options);
    this.memory = options.memory;
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
    input: SshJevInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<SshJevOutput>> {
    const incoming = input.text?.trim() ?? "";
    if (!incoming) return failure("VALIDATION_ERROR", "A remote-computer request is required");

    const devices = this.control.listDevices();
    const remembered = parseProtocolRemember(incoming);
    if (remembered) {
      await saveProtocol(this.memory, context.userId, remembered);
      return noop(devices, protocolConfirmation(remembered));
    }

    const matched = await findMatchingProtocol(this.memory, context.userId, incoming);
    const text = matched?.expansion ?? incoming;
    if (matched && !isRemoteInstruction(text)) return noop(devices, "");
    if (devices.length === 0) {
      return noop(devices, "Nessun computer è abbinato. Aggiungi host, utente e chiave SSH, poi installa Agent OS Remote sul Mac.");
    }

    const history = compactTurns(input.history, 10);
    const directUrl = extractUrl(text);
    if (directUrl && /\b(apri|open|agentos|http)\b/i.test(text)) {
      const device = (devices.length === 1 ? undefined : findDevice(devices, namedDevice(text))) ?? devices[0];
      return this.control.execute(
        { deviceId: device.id, action: "open_url", command: directUrl, text: directUrl },
        context,
      ) as Promise<CapabilityResult<SshJevOutput>>;
    }

    let answers: SystemAnswers;
    try {
      answers = await this.ask(
        {
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
        {
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
        context.signal,
      );
    } catch (error) {
      return failure("JEV_REQUEST_FAILED", errorMessage(error), true);
    }

    const action = selectedAction(answers.action?.choice);
    if (action === "none") {
      return noop(
        devices,
        isItalian(text)
          ? "Non mi sembra un comando per un computer remoto."
          : "That doesn't look like a remote-computer command.",
      );
    }

    const ranked = devices
      .map((device) => ({ device, noul: noulOf(answers, deviceQuestionId(device.id)) }))
      .filter((item) => item.noul >= DEVICE_THRESHOLD)
      .sort((left, right) => right.noul - left.noul);
    const device = ranked[0]?.device ?? (devices.length === 1 ? devices[0] : findDevice(devices, namedDevice(text)));
    if (!device && action !== "list") {
      const names = devices.map((item) => item.name).join(", ");
      return noop(devices, isItalian(text) ? `Quale computer? Ho: ${names}.` : `Which computer? I have: ${names}.`, action);
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
}

function selectedAction(value?: string): RemoteAction | "none" {
  return value && value in ACTIONS ? (value as RemoteAction | "none") : "none";
}

function deviceQuestionId(id: string): string {
  return `dev:${id}`;
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

// A reply that ran nothing over SSH.
function noop(
  devices: readonly RemoteDevice[],
  summary: string,
  action: RemoteAction | "none" = "none",
): CapabilityResult<SshJevOutput> {
  return {
    success: true,
    data: { deviceId: null, action, devices: publicDevices(devices), stdout: "", stderr: "", summary },
  };
}
