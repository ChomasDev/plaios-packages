import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@plaios/core/domain";

export interface RunCLICommandInput {
  command: string;
  args: readonly string[];
}

export interface RunCLICommandOutput {
  stdout: string;
  stderr: string;
}

/** `full` runs anything, `read-only` runs inspection tools on any path, `allowlist` runs only `allowedCommands` inside the workspace. */
export type CLIMode = "full" | "read-only" | "allowlist";

export interface RunCLICommandCapabilityOptions {
  mode?: CLIMode | string;
  allowedCommands?: readonly string[] | string;
  cwd?: string;
  env: Environment;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const COMMON_DOCS = `
## Inputs
No shell unless you start one: one executable, arguments as separate strings.
- \`{"command": "df", "args": ["-h"]}\`
- \`{"command": "ps", "args": ["-eo", "pid,comm,pcpu,pmem", "--sort=-pcpu"]}\`

## Limits and failures
- Non-zero exit returns \`COMMAND_FAILED\` with stderr; output is truncated past the configured size; a timeout kills the command.
- Secret environment variables are never passed to the child process.
- Not for Macs or other paired computers (use \`control_remote_computer\`), not for Home Assistant.
`;

const MODE_DOCS: Record<CLIMode, string> = {
  full: `# run_cli_command

Runs any executable on the PLAIOS server, as the user the server runs as, without restrictions. For pipes, redirects or several commands, run a shell: \`{"command": "bash", "args": ["-lc", "df -h | sort -k5 -r"]}\`. It can change the system, so confirm with the user before anything destructive (deleting, stopping services, installing).
`,
  "read-only": `# run_cli_command

Runs read-only inspection tools on the PLAIOS server, on any path: files (ls, cat, head, tail, grep, find, stat, wc, du), system (df, free, uname, uptime, lscpu, lsblk, sensors, smartctl, ps, top), network (ip, ss), services (systemctl status/list, journalctl) and Docker (docker ps/images/stats/inspect/logs). No shell, no pipes; commands that change things are refused with \`COMMAND_NOT_ALLOWED\` or \`ARGUMENT_NOT_ALLOWED\`.
`,
  allowlist: `# run_cli_command

Runs one executable from the operator's allowlist (the \`command\` description lists them), only inside the PLAIOS workspace: ls/find/stat/du cannot take absolute paths or \`..\`, find cannot run actions, ps cannot show environments, date cannot set the clock. Do not retry \`COMMAND_NOT_ALLOWED\` with variants; tell the user.
`,
};

const manifest: CapabilityManifest = {
  id: "cli.run-command",
  version: "1.0.0",
  name: "run_cli_command",
  description:
    "Runs one allowlisted executable on the PLAIOS server, without a shell. Use it to find or list workspace files, list installed packages, inspect processes, or check disk, memory, OS, folder, user, or date. Only the executables listed in the command field are accepted.",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Executable name: echo, pwd, ls, whoami, date, find, stat, df, du, free, uname, ps, which, whereis, or dpkg-query.",
      },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments passed directly to the executable.",
      },
    },
    required: ["command", "args"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      stdout: { type: "string" },
      stderr: { type: "string" },
    },
    required: ["stdout", "stderr"],
    additionalProperties: false,
  },
  permissions: ["cli.execute"],
  tags: ["cli", "command", "local"],
  execution: {
    timeoutMs: 30_000,
    idempotent: false,
  },
  examples: [
    {
      request: "Print hello in the CLI",
      arguments: {
        command: "echo",
        args: ["hello"],
      },
    },
    {
      request: "What is the current folder or repository?",
      arguments: {
        command: "pwd",
        args: [],
      },
    },
    {
      request: "List the files in the current directory",
      arguments: {
        command: "ls",
        args: ["-la"],
      },
    },
    {
      request: "Find a file named config.json in the PLAIOS workspace",
      arguments: {
        command: "find",
        args: [".", "-name", "config.json"],
      },
    },
    {
      request: "What packages are installed on this Debian or Ubuntu server?",
      arguments: {
        command: "dpkg-query",
        args: ["-W", "-f=${binary:Package} ${Version}\\n"],
      },
    },
  ],
};

const execFileAsync = promisify(execFile);

const readOnlyCommands = [
  "echo", "pwd", "ls", "whoami", "id", "date", "find", "stat", "df", "du", "free", "uname", "uptime", "hostname",
  "ps", "top", "which", "whereis", "dpkg-query", "cat", "head", "tail", "grep", "wc", "file", "lscpu", "lsblk",
  "lsusb", "lspci", "lsmod", "findmnt", "sensors", "smartctl", "nproc", "ip", "ss", "systemctl", "journalctl", "docker",
];

/** For tools that can also change things, the subcommands that only read. */
const readOnlySubcommands: Record<string, ReadonlySet<string>> = {
  systemctl: new Set(["status", "list-units", "list-unit-files", "list-timers", "is-active", "is-enabled", "is-failed", "show", "cat"]),
  docker: new Set(["ps", "images", "stats", "inspect", "logs", "version", "info", "top", "port", "df", "events", "history"]),
  ip: new Set(["addr", "address", "a", "link", "l", "route", "r", "neigh", "n", "-br", "-j", "-4", "-6", "-s"]),
};

const defaultAllowedCommands = [
  "echo",
  "pwd",
  "ls",
  "whoami",
  "date",
  "find",
  "stat",
  "df",
  "du",
  "free",
  "uname",
  "ps",
  "which",
  "whereis",
  "dpkg-query",
];

const unsafeFindActions = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
]);

export class RunCLICommandCapability
  implements Capability<RunCLICommandInput, RunCLICommandOutput>
{
  readonly manifest: CapabilityManifest;

  private readonly mode: CLIMode;
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly cwd?: string;
  private readonly env: Environment;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: RunCLICommandCapabilityOptions) {
    this.mode = parseMode(options.mode);
    this.allowedCommands = new Set(this.mode === "read-only" ? readOnlyCommands : normalizeAllowedCommands(options.allowedCommands));
    this.manifest = manifestFor(this.mode, [...this.allowedCommands]);
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxOutputBytes = Math.max(1_024, Math.trunc(options.maxOutputBytes ?? 32_768));
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return MODE_DOCS[this.mode] + COMMON_DOCS;
  }

  microfrontendData() {
    return {
      cwd: this.cwd ?? process.cwd(),
      mode: this.mode,
      allowedCommands: this.mode === "full" ? [] : [...this.allowedCommands],
      timeoutMs: this.timeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      shell: false,
      secretEnvironmentForwarded: false,
    };
  }

  async execute(
    input: RunCLICommandInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<RunCLICommandOutput>> {
    const command = input.command?.trim();
    if (!command) return failure("VALIDATION_ERROR", "Input 'command' is required");
    if (this.mode !== "full" && !this.allowedCommands.has(command)) {
      return failure("COMMAND_NOT_ALLOWED", `Command "${command}" is not allowed in ${this.mode} mode`);
    }
    const args = input.args;
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
      return failure("VALIDATION_ERROR", "Input 'args' must be an array of strings");
    }
    const argumentError = this.mode === "full" ? undefined : validateArguments(command, args, this.mode);
    if (argumentError) return failure("ARGUMENT_NOT_ALLOWED", argumentError);

    try {
      const result = await execFileAsync(command, [...args], {
        cwd: this.cwd,
        env: safeEnvironment(this.env),
        timeout: this.timeoutMs,
        signal: context.signal,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      return {
        success: true,
        data: {
          stdout: truncateOutput(result.stdout.trim(), this.maxOutputBytes),
          stderr: truncateOutput(result.stderr.trim(), this.maxOutputBytes),
        },
      };
    } catch (error) {
      const details = normalizeExecutionError(error);
      return {
        success: false,
        error: { code: "COMMAND_FAILED", message: details.stderr || details.message, retryable: false, details },
      };
    }
  }
}

const MODE_DESCRIPTIONS: Record<CLIMode, string> = {
  full: "Runs any command on the PLAIOS server (Linux), as the server's user: inspect or manage files, disks, hardware, processes, services, Docker, packages, logs and network. Use bash -lc for pipes. Confirm with the user before destructive changes.",
  "read-only": "Runs read-only inspection commands on the PLAIOS server (Linux) on any path: files, disks, hardware, processes, services, Docker, logs and network. Commands that change things are refused.",
  allowlist: manifest.description,
};

// The model sees what this mode accepts; execute() still enforces it.
function manifestFor(mode: CLIMode, commands: readonly string[]): CapabilityManifest {
  const schema = manifest.inputSchema as { properties: Record<string, object> };
  return {
    ...manifest,
    description: MODE_DESCRIPTIONS[mode],
    tags: mode === "allowlist" ? manifest.tags : [...(manifest.tags ?? []), "server", "linux", "system", "docker", "disk", "hardware", "logs", "processes", "services"],
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties,
        command: {
          type: "string",
          description: mode === "full" ? "Executable name or path, e.g. df, docker, bash." : `Executable name. Allowed: ${commands.join(", ")}.`,
        },
      },
    },
  };
}

function parseMode(value: string | undefined): CLIMode {
  const mode = value?.trim() || "full";
  if (mode !== "full" && mode !== "read-only" && mode !== "allowlist") throw new Error(`mode must be full, read-only or allowlist: "${mode}"`);
  return mode;
}

function normalizeAllowedCommands(value: readonly string[] | string | undefined): string[] {
  if (typeof value === "string") {
    return value.split(",").map((command) => command.trim()).filter(Boolean);
  }
  return [...(value ?? defaultAllowedCommands)];
}

const workspaceCommands = new Set(["ls", "find", "stat", "du"]);
const SECRET_FILE = /(^|[/=])\.env(\.[\w-]+)?$|id_(rsa|ecdsa|ed25519)$|\.(pem|key)$|credentials(\.json)?$|\/shadow$/;

function validateArguments(command: string, args: readonly string[], mode: CLIMode): string | undefined {
  if (mode === "read-only") {
    const allowed = readOnlySubcommands[command];
    const subcommand = args.find((argument) => !argument.startsWith("-") || command === "ip");
    if (allowed && subcommand !== undefined && !allowed.has(subcommand)) return `${command} ${subcommand} can change the system; only ${[...allowed].join(", ")} are allowed`;
    if (command === "date" && args.some((argument) => argument === "-s" || argument.startsWith("--set"))) return "Setting the clock is not allowed";
    if (command === "smartctl" && args.some((argument) => /^(-s|--smart|-t|--test|-X|--abort|-o|--offlineauto|-S|--saveauto)/.test(argument))) return "smartctl options that change the drive are not allowed";
    if (command === "journalctl" && args.some((argument) => /^--(rotate|vacuum|flush|sync|relinquish)/.test(argument))) return "journalctl maintenance options are not allowed";
    // Read-only still must not hand the model the secrets the host keeps out of its environment.
    const secret = args.find((argument) => SECRET_FILE.test(argument));
    if (secret) return `Reading secret files is not allowed: "${secret}"`;
  }
  if (mode === "allowlist" && workspaceCommands.has(command)) {
    const unsafePath = args.find((argument) => isUnsafeWorkspacePath(argument));
    if (unsafePath) return `Path outside the PLAIOS workspace is not allowed: "${unsafePath}"`;
    // A files0-from list echoes each unreadable "name" back, which would leak any file's contents (.env included).
    if (args.some((argument) => /^-?-files0-from/.test(argument))) return "files0-from is not allowed";
  }
  if (command === "find") {
    if (args.some((argument) => argument === "-L" || argument === "-H")) {
      return "Following symbolic links is not allowed";
    }
    const unsafeAction = args.find((argument) => unsafeFindActions.has(argument.toLowerCase()));
    if (unsafeAction) return `find action "${unsafeAction}" is not allowed`;
  }
  if (command === "ps") {
    // BSD "e" (in "e", "aux e", "auxe") prints other processes' environments, secrets included; "-e" and -o fields are fine.
    const environmentFlag = args.find((argument, index) =>
      /^[a-zA-Z]+$/.test(argument) && argument.includes("e") && !/^(-o|-O|o|O|--format|-p|p|-u|-U|-C|--sort|k)$/.test(args[index - 1] ?? ""),
    );
    if (environmentFlag) return `ps environment flag "${environmentFlag}" is not allowed`;
  }
  if (command === "date" && args.some((argument) =>
    argument === "-s" || argument.startsWith("--set") || argument === "-f" || argument.startsWith("--file"),
  )) return "date file and clock mutation options are not allowed";
  return undefined;
}

function isUnsafeWorkspacePath(argument: string): boolean {
  // Options can carry paths too, e.g. du --files0-from=/etc/shadow.
  if (argument.startsWith("-")) {
    const separator = argument.indexOf("=");
    if (separator === -1) return false;
    argument = argument.slice(separator + 1);
  }
  if (argument.startsWith("/")) return true;
  return argument.split(/[\\/]/).includes("..");
}

function safeEnvironment(environment: Environment): NodeJS.ProcessEnv {
  const values = environment.getAll();
  const allowed = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ"];
  const result: NodeJS.ProcessEnv = { PATH: values.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
  for (const key of allowed) if (values[key] !== undefined) result[key] = values[key];
  return result;
}

function truncateOutput(value: string, maximum: number): string {
  if (Buffer.byteLength(value, "utf8") <= maximum) return value;
  return `${Buffer.from(value).subarray(0, maximum).toString("utf8")}\n… output truncated …`;
}

function failure(code: string, message: string): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}

function normalizeExecutionError(error: unknown): { message: string; stdout: string; stderr: string } {
  if (!(error instanceof Error)) return { message: "CLI command failed", stdout: "", stderr: "" };
  const { stdout, stderr } = error as Error & { stdout?: string; stderr?: string };
  return { message: error.message, stdout: stdout?.trim() ?? "", stderr: stderr?.trim() ?? "" };
}
