import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@agent-os/core/domain";

export interface RunCLICommandInput {
  command: string;
  args: readonly string[];
}

export interface RunCLICommandOutput {
  stdout: string;
  stderr: string;
}

export interface RunCLICommandCapabilityOptions {
  allowedCommands?: readonly string[] | string;
  cwd?: string;
  env: Environment;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const DOCS = `# run_cli_command

Runs one executable on the Agent OS server, without a shell, from the Agent OS workspace. Only executables in the configured allowlist are accepted (the \`command\` description lists them); by default these are read-only inspection tools (ls, find, stat, df, du, free, uname, ps, which, dpkg-query, ...). \`ssh\` and other tools work only if the operator added them to the allowlist.

## When to use
- Inspecting the server itself: files in the workspace, disk, memory, OS, processes, installed packages, date, user.
- Not for Macs or other paired computers (use \`control_remote_computer\` / \`control_remote_computer_jev\`), not for Home Assistant.

## Inputs
No shell: no pipes, redirects, globs, \`&&\` or env expansion. One executable, arguments as separate strings.
- \`{"command": "df", "args": ["-h"]}\`
- \`{"command": "find", "args": [".", "-name", "config.json"]}\`
- \`{"command": "ps", "args": ["-o", "pid,comm,%cpu", "-A"]}\`

## Limits and failures
- \`COMMAND_NOT_ALLOWED\`: the executable is not in the allowlist; do not retry with variants, tell the user.
- \`ARGUMENT_NOT_ALLOWED\`: ls/find/stat/du cannot take absolute paths or \`..\`; find cannot use -exec, -delete, -L and similar; ps cannot show environments; date cannot set the clock.
- Default timeout 5s; stdout/stderr are truncated (default 32 KB). Non-zero exit returns \`COMMAND_FAILED\` with stderr.
- Secret environment variables are never passed to the child process.
`;

const manifest: CapabilityManifest = {
  id: "cli.run-command",
  version: "1.0.0",
  name: "run_cli_command",
  description:
    "Runs one allowlisted executable on the Agent OS server, without a shell. Use it to find or list workspace files, list installed packages, inspect processes, or check disk, memory, OS, folder, user, or date. Only the executables listed in the command field are accepted.",
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
    timeoutMs: 5_000,
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
      request: "Find a file named config.json in the Agent OS workspace",
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

  private readonly allowedCommands: ReadonlySet<string>;
  private readonly cwd?: string;
  private readonly env: Environment;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: RunCLICommandCapabilityOptions) {
    this.allowedCommands = new Set(normalizeAllowedCommands(options.allowedCommands));
    this.manifest = withAllowedCommands([...this.allowedCommands]);
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxOutputBytes = Math.max(1_024, Math.trunc(options.maxOutputBytes ?? 32_768));
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  microfrontendData() {
    return {
      cwd: this.cwd ?? process.cwd(),
      allowedCommands: [...this.allowedCommands],
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
    if (!this.allowedCommands.has(command)) {
      return failure("COMMAND_NOT_ALLOWED", `Command "${command}" is not allowed`);
    }
    const args = input.args;
    if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
      return failure("VALIDATION_ERROR", "Input 'args' must be an array of strings");
    }
    const argumentError = validateArguments(command, args);
    if (argumentError) return failure("ARGUMENT_NOT_ALLOWED", argumentError);

    try {
      const result = await execFileAsync(command, [...args], {
        cwd: this.cwd,
        env: safeEnvironment(this.env),
        timeout: this.timeoutMs,
        signal: context.signal,
        encoding: "utf8",
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

// The model sees the configured allowlist; execute() still enforces it.
function withAllowedCommands(commands: readonly string[]): CapabilityManifest {
  const schema = manifest.inputSchema as { properties: Record<string, object> };
  return {
    ...manifest,
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties,
        command: {
          type: "string",
          description: `Executable name. Allowed: ${commands.join(", ")}.`,
        },
      },
    },
  };
}

function normalizeAllowedCommands(value: readonly string[] | string | undefined): string[] {
  if (typeof value === "string") {
    return value.split(",").map((command) => command.trim()).filter(Boolean);
  }
  return [...(value ?? defaultAllowedCommands)];
}

const workspaceCommands = new Set(["ls", "find", "stat", "du"]);

function validateArguments(command: string, args: readonly string[]): string | undefined {
  if (workspaceCommands.has(command)) {
    const unsafePath = args.find((argument) => isUnsafeWorkspacePath(argument));
    if (unsafePath) return `Path outside the Agent OS workspace is not allowed: "${unsafePath}"`;
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
    const environmentFlag = args.find((argument) =>
      argument === "e" || (!argument.startsWith("-") && /e/i.test(argument)),
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
