import type { RemoteDevice } from "./devices.js";

export type RemoteAction =
  | "list"
  | "status"
  | "exec"
  | "open_app"
  | "open_url"
  | "quit_app"
  | "notify"
  | "lock"
  | "sleep_display"
  | "wake_display"
  | "set_volume"
  | "speak"
  | "screenshot"
  | "osascript";

export interface RemoteCommandInput {
  deviceId?: string | null;
  action: RemoteAction;
  command?: string | null;
  app?: string | null;
  text?: string | null;
  value?: number | null;
}

export function remoteShellCommand(device: RemoteDevice, input: RemoteCommandInput): string {
  if (device.os === "linux") return linuxCommand(input);
  return macosCommand(input);
}

function macosCommand(input: RemoteCommandInput): string {
  const helper = "~/.agent-os-remote/bin/agent-os-remote";
  switch (input.action) {
    case "status":
      return `${helper} status || { hostname; whoami; uptime; sw_vers; }`;
    case "exec":
      return required(input.command, "A command is required");
    case "open_app":
      return `${helper} open ${quote(appName(input))} || open -a ${quote(appName(input))}`;
    case "open_url":
      return `open ${quote(required(input.command ?? input.text, "A URL is required"))}`;
    case "quit_app":
      return `${helper} quit ${quote(appName(input))} || osascript -e ${quote(`tell application ${jsQuote(appName(input))} to quit`)}`;
    case "notify":
      return `${helper} notify ${quote(input.text ?? "Agent OS")} || osascript -e ${quote(`display notification ${jsQuote(input.text ?? "Agent OS")} with title "Agent OS"`)}`;
    case "lock":
      return `${helper} lock || pmset displaysleepnow`;
    case "sleep_display":
      return `${helper} sleep-display || pmset displaysleepnow`;
    case "wake_display":
      return `${helper} wake || caffeinate -u -t 2`;
    case "set_volume":
      return `${helper} volume ${volume(input.value)} || osascript -e ${quote(`set volume output volume ${volume(input.value)}`)}`;
    case "speak":
      return `${helper} say ${quote(required(input.text, "Text to speak is required"))} || say ${quote(required(input.text, "Text to speak is required"))}`;
    case "screenshot":
      return `${helper} screenshot || { /usr/sbin/screencapture -x /tmp/agent-os-screenshot.png && echo /tmp/agent-os-screenshot.png; }`;
    case "osascript":
      return `osascript -e ${quote(required(input.command ?? input.text, "An AppleScript is required"))}`;
    case "list":
      return "echo ready";
  }
}

function linuxCommand(input: RemoteCommandInput): string {
  switch (input.action) {
    case "status":
      return "hostname; whoami; uptime; uname -a";
    case "exec":
      return required(input.command, "A command is required");
    case "open_url":
      return `xdg-open ${quote(required(input.command ?? input.text, "A URL is required"))} || true`;
    case "notify":
      return `notify-send AgentOS ${quote(input.text ?? "Agent OS")}`;
    case "lock":
      return "loginctl lock-session || true";
    case "sleep_display":
      return "xset dpms force off || true";
    case "wake_display":
      return "xset dpms force on || true";
    case "set_volume":
      return `pactl set-sink-volume @DEFAULT_SINK@ ${volume(input.value)}%`;
    case "speak":
      return `espeak ${quote(required(input.text, "Text to speak is required"))}`;
    case "screenshot":
      return "import -window root /tmp/agent-os-screenshot.png && echo /tmp/agent-os-screenshot.png";
    default:
      throw new Error(`Action ${input.action} is only supported on macOS devices`);
  }
}

function appName(input: RemoteCommandInput): string {
  return required(input.app ?? input.text ?? input.command, "An application name is required");
}

function volume(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) throw new Error("A volume percentage is required");
  return Math.round(Math.min(100, Math.max(0, value)));
}

function required(value: string | null | undefined, message: string): string {
  const text = value?.trim();
  if (!text) throw new Error(message);
  return text;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function jsQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
