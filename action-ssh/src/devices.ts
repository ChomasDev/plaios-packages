export interface RemoteDevice {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  os: "macos" | "linux" | "unknown";
  privateKeyPath?: string;
  privateKey?: string;
}

export interface PublicDevice {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  os: RemoteDevice["os"];
  hasKey: boolean;
}

export function parseDevices(options: {
  devices?: unknown;
  host?: string;
  user?: string;
  port?: number | string;
  privateKey?: string;
  privateKeyPath?: string;
  env?: { get(key: string): string | undefined };
}): RemoteDevice[] {
  const fromJson = readJsonDevices(
    firstText(options.devices) ?? options.env?.get("SSH_DEVICES"),
  );
  const single = singleDevice(options);
  const devices = [...fromJson, ...(single ? [single] : [])];
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (seen.has(device.id)) return false;
    seen.add(device.id);
    return true;
  });
}

export function publicDevices(devices: readonly RemoteDevice[]): PublicDevice[] {
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    host: device.host,
    user: device.user,
    port: device.port,
    os: device.os,
    hasKey: Boolean(device.privateKeyPath || device.privateKey),
  }));
}

export function findDevice(
  devices: readonly RemoteDevice[],
  deviceId?: string | null,
): RemoteDevice | undefined {
  if (deviceId?.trim()) {
    const needle = deviceId.trim().toLowerCase();
    return devices.find((device) =>
      device.id.toLowerCase() === needle || device.name.toLowerCase() === needle,
    );
  }
  return devices.length === 1 ? devices[0] : undefined;
}

function singleDevice(options: {
  host?: string;
  user?: string;
  port?: number | string;
  privateKey?: string;
  privateKeyPath?: string;
  env?: { get(key: string): string | undefined };
}): RemoteDevice | undefined {
  const host = options.host ?? options.env?.get("SSH_HOST");
  const user = options.user ?? options.env?.get("SSH_USER");
  if (!host || !user) return undefined;
  return normalizeDevice({
    id: options.env?.get("SSH_DEVICE_ID") ?? slug(`${user}@${host}`),
    name: options.env?.get("SSH_DEVICE_NAME") ?? `${user}@${host}`,
    host,
    user,
    port: options.port ?? options.env?.get("SSH_PORT"),
    os: options.env?.get("SSH_OS"),
    privateKey: options.privateKey ?? options.env?.get("SSH_PRIVATE_KEY"),
    privateKeyPath: options.privateKeyPath ?? options.env?.get("SSH_PRIVATE_KEY_PATH"),
  });
}

function readJsonDevices(value?: string): RemoteDevice[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("SSH devices must be a JSON array");
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`SSH device ${index} is invalid`);
    return normalizeDevice(entry as Record<string, unknown>);
  });
}

function normalizeDevice(value: Record<string, unknown>): RemoteDevice {
  const host = text(value.host) ?? text(value.ip);
  const user = text(value.user) ?? text(value.username);
  if (!host || !user) throw new Error("Each SSH device needs host and user");
  const id = text(value.id) ?? slug(`${user}@${host}`);
  return {
    id,
    name: text(value.name) ?? `${user}@${host}`,
    host,
    user,
    port: portOf(value.port),
    os: osOf(value.os),
    privateKey: text(value.privateKey) ?? text(value.key),
    privateKeyPath: text(value.privateKeyPath) ?? text(value.keyPath),
  };
}

function portOf(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH port must be 1-65535");
  return port;
}

function osOf(value: unknown): RemoteDevice["os"] {
  const os = String(value ?? "").toLowerCase();
  if (os === "macos" || os === "darwin" || os === "mac") return "macos";
  if (os === "linux") return "linux";
  return "unknown";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value == null) return undefined;
  return JSON.stringify(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "device";
}
