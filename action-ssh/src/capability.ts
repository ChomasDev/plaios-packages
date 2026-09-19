import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@agent-os/core/domain";

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { remoteShellCommand, type RemoteAction, type RemoteCommandInput } from "./commands.js";
import { findDevice, parseDevices, publicDevices, type PublicDevice, type RemoteDevice } from "./devices.js";
import { runScp, runSsh, type ScpRunner, type SshRunner } from "./ssh.js";

export interface SshControlInput extends RemoteCommandInput {}

export interface SshControlOutput {
  deviceId: string | null;
  action: RemoteAction;
  devices: PublicDevice[];
  stdout: string;
  stderr: string;
  summary: string;
  localPath?: string;
}

export interface SshDashboard {
  devices: PublicDevice[];
  updatedAt: string;
  actions: {
    refresh(): Promise<SshDashboard>;
    control(input: SshControlInput): Promise<SshControlOutput>;
  };
}

export interface SshCapabilityOptions {
  env: Environment;
  devices?: unknown;
  host?: string;
  user?: string;
  port?: number | string;
  privateKey?: string;
  privateKeyPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  ssh?: SshRunner;
  scp?: ScpRunner;
}

const manifest: CapabilityManifest = {
  id: "ssh.control",
  version: "1.0.0",
  name: "control_remote_computer",
  description:
    "Controls paired computers over SSH. List devices, check status, open or quit macOS apps, change volume, lock the screen, speak, take a screenshot, or run a command on a named Mac or Linux host.",
  inputSchema: {
    type: "object",
    properties: {
      deviceId: { type: ["string", "null"], description: "Paired device id or name." },
      action: {
        type: "string",
        enum: [
          "list",
          "status",
          "exec",
          "open_app",
          "open_url",
          "quit_app",
          "notify",
          "lock",
          "sleep_display",
          "wake_display",
          "set_volume",
          "speak",
          "screenshot",
          "osascript",
        ],
      },
      command: { type: ["string", "null"] },
      app: { type: ["string", "null"] },
      text: { type: ["string", "null"] },
      value: { type: ["number", "null"] },
    },
    required: ["action"],
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
  tags: ["ssh", "macos", "mac", "computer", "remote", "desktop"],
  execution: { timeoutMs: 20_000, idempotent: false },
  examples: [
    { request: "What Macs are paired?", arguments: { action: "list", deviceId: null } },
    { request: "Open Safari on the Mac", arguments: { action: "open_app", deviceId: "mac", app: "Safari" } },
  ],
};

export class SshCapability implements Capability<SshControlInput, SshControlOutput> {
  readonly manifest = manifest;
  private readonly devices: RemoteDevice[];
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly ssh: SshRunner;
  private readonly scp: ScpRunner | undefined;

  constructor(options: SshCapabilityOptions) {
    this.devices = parseDevices(options);
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? 15_000));
    this.maxOutputBytes = Math.max(1_024, Number(options.maxOutputBytes ?? 65_536));
    this.ssh = options.ssh ?? runSsh;
    this.scp = options.scp ?? (options.ssh ? undefined : runScp);
  }

  listDevices(): RemoteDevice[] {
    return this.devices;
  }

  async microfrontendData(): Promise<SshDashboard> {
    return {
      devices: publicDevices(this.devices),
      updatedAt: new Date().toISOString(),
      actions: {
        refresh: async () => this.microfrontendData(),
        control: async (input) => {
          const result = await this.execute(input, {
            runId: "ui",
            callId: "ui",
            startedAt: new Date(),
          });
          if (!result.success) throw new Error(result.error.message);
          return result.data;
        },
      },
    };
  }

  async execute(
    input: SshControlInput,
    _context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<SshControlOutput>> {
    const action = input.action;
    const visible = publicDevices(this.devices);
    if (action === "list") {
      return success({
        deviceId: null,
        action,
        devices: visible,
        stdout: "",
        stderr: "",
        summary: visible.length
          ? `Paired computers: ${visible.map((device) => device.name).join(", ")}.`
          : "No computers are paired yet. Add host, user, and an SSH key, then install Agent OS Remote on the Mac.",
      });
    }

    if (this.devices.length === 0) {
      return failure("NO_DEVICES", "No SSH devices are configured.");
    }

    const device = findDevice(this.devices, input.deviceId);
    if (!device) {
      return failure(
        "DEVICE_NOT_FOUND",
        input.deviceId
          ? `I don't have a paired computer named "${input.deviceId}".`
          : "Say which computer you mean. Paired devices: " +
            this.devices.map((item) => item.name).join(", ") + ".",
      );
    }

    if (!device.privateKey && !device.privateKeyPath) {
      return failure("MISSING_KEY", `Device ${device.name} has no SSH private key.`);
    }

    let command: string;
    try {
      command = remoteShellCommand(device, input);
    } catch (error) {
      return failure("VALIDATION_ERROR", error instanceof Error ? error.message : String(error));
    }

    try {
      const result = await this.ssh({
        device,
        command,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      });
      const fetched = await this.fetchScreenshot(device, action, result);
      const output = truncate(result.stdout || result.stderr || fetched.error || "", this.maxOutputBytes);
      return success({
        deviceId: device.id,
        action,
        devices: visible,
        stdout: truncate(result.stdout, this.maxOutputBytes),
        stderr: truncate(
          [result.stderr, fetched.error].filter(Boolean).join("\n"),
          this.maxOutputBytes,
        ),
        summary: summarize(device, action, input, output, result.code),
        ...(fetched.localPath ? { localPath: fetched.localPath } : {}),
      });
    } catch (error) {
      return failure(
        "SSH_FAILED",
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  }

  private async fetchScreenshot(
    device: RemoteDevice,
    action: RemoteAction,
    result: { stdout: string; code: number },
  ): Promise<{ localPath?: string; error?: string }> {
    if (action !== "screenshot" || result.code !== 0 || !this.scp) return {};
    const remotePath = screenshotRemotePath(result.stdout);
    const localPath = join(tmpdir(), `agent-os-screenshot-${randomUUID()}.png`);
    try {
      await this.scp({
        device,
        remotePath,
        localPath,
        timeoutMs: this.timeoutMs,
      });
      return { localPath };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function summarize(
  device: RemoteDevice,
  action: RemoteAction,
  input: SshControlInput,
  output: string,
  code: number,
): string {
  const target = device.name;
  if (code !== 0) {
    return `I could not reach ${target}: ${output || `ssh exited ${code}`}.`;
  }
  switch (action) {
    case "status":
      return output.trim() || `${target} is reachable.`;
    case "open_app":
      return `Opened ${input.app ?? input.text} on ${target}.`;
    case "open_url":
      return `Opened ${input.command ?? input.text} on ${target}.`;
    case "quit_app":
      return `Quit ${input.app ?? input.text} on ${target}.`;
    case "notify":
      return `Sent a notification on ${target}.`;
    case "lock":
    case "sleep_display":
      return `I put the display on ${target} to sleep.`;
    case "wake_display":
      return `I woke the display on ${target}.`;
    case "set_volume":
      return `Set volume on ${target} to ${input.value}%.`;
    case "speak":
      return `Spoke on ${target}.`;
    case "screenshot":
      return `Captured a screenshot on ${target}${output.trim() ? ` (${output.trim()})` : ""}.`;
    default:
      return output.trim() || `Done on ${target}.`;
  }
}

function screenshotRemotePath(stdout: string): string {
  const match =
    stdout.match(/(\/(?:tmp|Users|home|var)\S+\.(?:png|jpe?g|webp))/i) ??
    stdout.match(/(\/\S+\.png)/i);
  return match?.[1] ?? "/tmp/agent-os-screenshot.png";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

function success(data: SshControlOutput): CapabilityResult<SshControlOutput> {
  return { success: true, data };
}

function failure(code: string, message: string, retryable = false): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
