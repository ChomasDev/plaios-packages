import { execFile, type ExecFileOptions } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RemoteDevice } from "./devices.js";

const execFileAsync = promisify(execFile);

export interface SshExecRequest {
  device: RemoteDevice;
  command: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type SshRunner = (request: SshExecRequest) => Promise<SshExecResult>;

export interface ScpRequest {
  device: RemoteDevice;
  remotePath: string;
  localPath: string;
  timeoutMs: number;
}

export type ScpRunner = (request: ScpRequest) => Promise<void>;

export function sshArguments(device: RemoteDevice, command: string, keyPath: string): string[] {
  return [
    "-F", "/dev/null",
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=8",
    "-o", "PreferredAuthentications=publickey",
    "-i", keyPath,
    "-p", String(device.port),
    `${device.user}@${device.host}`,
    command,
  ];
}

export async function runSsh(request: SshExecRequest): Promise<SshExecResult> {
  const key = await materializeKey(request.device);
  try {
    const options: ExecFileOptions = {
      timeout: request.timeoutMs,
      maxBuffer: request.maxOutputBytes,
      windowsHide: true,
    };
    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArguments(request.device, request.command, key.path), options);
      return {
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: 0,
      };
    } catch (error) {
      const details = error as { stdout?: string; stderr?: string; code?: number; message?: string };
      if (details.stdout !== undefined || details.stderr !== undefined) {
        return {
          stdout: String(details.stdout ?? ""),
          stderr: String(details.stderr ?? details.message ?? "ssh failed"),
          code: typeof details.code === "number" ? details.code : 1,
        };
      }
      throw error;
    }
  } finally {
    await key.cleanup();
  }
}

export function scpArguments(
  device: RemoteDevice,
  remotePath: string,
  localPath: string,
  keyPath: string,
): string[] {
  return [
    "-F", "/dev/null",
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=8",
    "-o", "PreferredAuthentications=publickey",
    "-i", keyPath,
    "-P", String(device.port),
    `${device.user}@${device.host}:${remotePath}`,
    localPath,
  ];
}

export async function runScp(request: ScpRequest): Promise<void> {
  const key = await materializeKey(request.device);
  try {
    const options: ExecFileOptions = {
      timeout: request.timeoutMs,
      windowsHide: true,
    };
    await execFileAsync(
      "scp",
      scpArguments(request.device, request.remotePath, request.localPath, key.path),
      options,
    );
  } finally {
    await key.cleanup();
  }
}

async function materializeKey(device: RemoteDevice): Promise<{ path: string; cleanup(): Promise<void> }> {
  if (device.privateKeyPath) {
    return { path: device.privateKeyPath, cleanup: async () => undefined };
  }
  if (!device.privateKey) throw new Error(`Device ${device.id} has no SSH private key`);
  const directory = await mkdtemp(join(tmpdir(), "agent-os-ssh-"));
  const path = join(directory, "id");
  await writeFile(path, `${device.privateKey.trim()}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return {
    path,
    cleanup: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
