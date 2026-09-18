import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Environment } from "@agent-os/core";

export interface EnvironmentVariableDto {
  key: string;
  value: string;
  displayValue: string;
  secret: boolean;
  isSet: boolean;
  source: "process" | "dotenv" | "unset";
}

export interface EnvironmentMicrofrontendData {
  source: "process" | "dotenv" | "map" | "composite";
  providerCount: number;
  configuredCount: number;
  variables: EnvironmentVariableDto[];
  update?: (updates: Record<string, string | null>) => Promise<EnvironmentVariableDto[]>;
}

abstract class BaseEnvironment implements Environment {
  abstract get(key: string): string | undefined;
  abstract getAll(): Record<string, string>;
  getRequired(key: string): string { const value = this.get(key); if (value === undefined) throw new Error(`Missing required environment variable: ${key}`); return value; }
  getOrDefault(key: string, fallback: string): string { return this.get(key) ?? fallback; }
  has(key: string): boolean { return this.get(key) !== undefined; }
}

export interface ProcessEnvironmentOptions { values?: NodeJS.ProcessEnv; }
export class ProcessEnvironment extends BaseEnvironment {
  private readonly values: NodeJS.ProcessEnv;
  constructor(options: ProcessEnvironmentOptions = {}) { super(); this.values = options.values ?? process.env; }
  get(key: string): string | undefined { return normalizeValue(this.values[key]); }
  getAll(): Record<string, string> { return toEnvironmentRecord(Object.entries(this.values)); }
  microfrontendData(): EnvironmentMicrofrontendData { return { source: "process", providerCount: 1, configuredCount: Object.keys(this.getAll()).length, variables: [] }; }
}

export interface DotenvEnvironmentOptions { filePath?: string; exampleFilePath?: string; required?: boolean; cwd?: string; }
export class DotenvEnvironment extends BaseEnvironment {
  private readonly filePath: string;
  private readonly exampleFilePath: string;
  private values = new Map<string, string>();
  constructor(options: DotenvEnvironmentOptions = {}) {
    super();
    const cwd = options.cwd ?? process.cwd();
    this.filePath = resolveFrom(cwd, options.filePath ?? ".env");
    this.exampleFilePath = resolveFrom(cwd, options.exampleFilePath ?? ".env.example");
    if (!existsSync(this.filePath)) { if (options.required) throw new Error(`Environment file not found: ${this.filePath}`); return; }
    this.values = parseDotenv(readFileSync(this.filePath, "utf8"));
  }
  get(key: string): string | undefined { return normalizeValue(this.values.get(key)); }
  getAll(): Record<string, string> { return toEnvironmentRecord(this.values); }
  microfrontendData(): EnvironmentMicrofrontendData {
    const data = () => this.safeVariables();
    return { source: "dotenv", providerCount: 1, configuredCount: data().filter(({ isSet }) => isSet).length, variables: data(), update: async (updates) => { await this.updateAllowed(updates); return data(); } };
  }
  private safeVariables(): EnvironmentVariableDto[] {
    const example = existsSync(this.exampleFilePath) ? parseDotenv(readFileSync(this.exampleFilePath, "utf8")) : new Map<string, string>();
    const keys = [...new Set([...example.keys(), ...this.values.keys()])].sort();
    return keys.map((key) => {
      const processValue = process.env[key];
      const dotenvValue = this.values.get(key);
      const raw = processValue ?? dotenvValue ?? "";
      const secret = isSecretKey(key);
      return { key, value: secret ? "" : raw, displayValue: secret ? maskSecret(raw) : raw, secret, isSet: raw !== "", source: processValue !== undefined ? "process" : dotenvValue !== undefined ? "dotenv" : "unset" };
    });
  }
  private async updateAllowed(updates: Record<string, string | null>): Promise<void> {
    const variables = this.safeVariables();
    const sources = new Map(variables.map((variable) => [variable.key, variable]));
    for (const [rawKey, value] of Object.entries(updates)) {
      const key = rawKey.trim();
      if (!isEnvironmentKey(key)) throw new Error(`Invalid environment variable name: ${rawKey}`);
      const variable = sources.get(key);
      if (variable?.source === "process" || process.env[key] !== undefined) {
        throw new Error(`${key} is supplied by the process environment and is read-only`);
      }
      if (value === null) this.values.delete(key);
      else if (value !== "" || !isSecretKey(key)) this.values.set(key, value);
    }
    const output = [...this.values.entries()].map(([key, value]) => `${key}=${quoteEnv(value)}`).join("\n");
    const temporary = `${this.filePath}.agent-os-tmp`;
    await writeFile(temporary, output ? `${output}\n` : "", { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export class MapEnvironment extends BaseEnvironment {
  private readonly values: Map<string, string>;
  constructor(options: Readonly<Record<string, string>> | { values?: Readonly<Record<string, string>> } = {}) { super(); const values = "values" in options && typeof options.values === "object" ? options.values ?? {} : options as Readonly<Record<string, string>>; this.values = new Map(Object.entries(values)); }
  get(key: string): string | undefined { return normalizeValue(this.values.get(key)); }
  getAll(): Record<string, string> { return toEnvironmentRecord(this.values); }
  set(key: string, value: string): void { this.values.set(key, value); }
  delete(key: string): void { this.values.delete(key); }
  microfrontendData(): EnvironmentMicrofrontendData { return { source: "map", providerCount: 1, configuredCount: this.values.size, variables: [...this.values].map(([key, value]) => ({ key, value, displayValue: value, secret: false, isSet: value !== "", source: "dotenv" })) }; }
}

export interface CompositeEnvironmentOptions { providers?: readonly Environment[]; cwd?: string; filePath?: string; exampleFilePath?: string; }
export class CompositeEnvironment extends BaseEnvironment {
  private readonly providers: readonly Environment[];
  constructor(options: CompositeEnvironmentOptions | readonly Environment[] = {}) {
    super();
    if (Array.isArray(options)) {
      this.providers = options as readonly Environment[];
    } else {
      const configuration = options as CompositeEnvironmentOptions;
      this.providers = configuration.providers ?? [new ProcessEnvironment(), new DotenvEnvironment(configuration)];
    }
    if (this.providers.length === 0) throw new Error("CompositeEnvironment requires at least one provider");
  }
  get(key: string): string | undefined { for (const provider of this.providers) { const value = provider.get(key); if (value !== undefined) return value; } return undefined; }
  getAll(): Record<string, string> { const values: Record<string, string> = {}; for (let index = this.providers.length - 1; index >= 0; index -= 1) Object.assign(values, this.providers[index]?.getAll()); return values; }
  microfrontendData(): EnvironmentMicrofrontendData {
    const managed = this.providers.find((provider) => provider instanceof DotenvEnvironment) as DotenvEnvironment | undefined;
    const data = managed?.microfrontendData();
    return { source: "composite", providerCount: this.providers.length, configuredCount: Object.keys(this.getAll()).length, variables: data?.variables ?? [], ...(data?.update ? { update: data.update } : {}) };
  }
}

export { CompositeEnvironment as CompositeEnvAdapter, DotenvEnvironment as DotenvFileAdapter, MapEnvironment as MapEnvAdapter, ProcessEnvironment as NodeEnvironment, ProcessEnvironment as ProcessEnvAdapter };

export function parseDotenv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) { const line = rawLine.trim(); if (!line || line.startsWith("#")) continue; const separator = line.indexOf("="); if (separator <= 0) continue; const key = line.slice(0, separator).trim(); let value = line.slice(separator + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); values.set(key, value); }
  return values;
}

function resolveFrom(cwd: string, path: string): string { return isAbsolute(path) ? path : resolve(cwd, path); }
function normalizeValue(value: string | undefined): string | undefined { return value === undefined || value === "" ? undefined : value; }
function toEnvironmentRecord(entries: Iterable<readonly [string, string | undefined]>): Record<string, string> { const values: Record<string, string> = {}; for (const [key, raw] of entries) { const value = normalizeValue(raw); if (value !== undefined) values[key] = value; } return values; }
function isEnvironmentKey(key: string): boolean { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key); }
function isSecretKey(key: string): boolean { return /(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|COOKIE)/i.test(key); }
function maskSecret(value: string): string { if (!value) return "Not set"; return value.length <= 4 ? "••••" : `${value.slice(0, 2)}${"•".repeat(Math.min(10, value.length - 4))}${value.slice(-2)}`; }
function quoteEnv(value: string): string { return /^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value); }
