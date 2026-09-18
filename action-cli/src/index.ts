import { execFile } from "node:child_process";
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

const manifest: CapabilityManifest = {
  id: "cli.run-command",
  version: "1.0.0",
  name: "run_cli_command",
  description:
    "Inspects the local runtime by running an allowed read-only CLI command without invoking a shell. Use it to find or list files, list installed packages, inspect processes, check disk space or storage, check memory or RAM usage, identify the operating system, get the current folder, user, or date.",
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
  readonly manifest = manifest;

  private readonly allowedCommands: ReadonlySet<string>;
  private readonly cwd?: string;
  private readonly env: Environment;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: RunCLICommandCapabilityOptions) {
    this.allowedCommands = new Set(normalizeAllowedCommands(options.allowedCommands));
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs =
      options.timeoutMs ?? manifest.execution?.timeoutMs ?? 5_000;
    this.maxOutputBytes = Math.max(1_024, Math.trunc(options.maxOutputBytes ?? 32_768));
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

    if (!command) {
      return failure("VALIDATION_ERROR", "Input 'command' is required");
    }

    if (!this.allowedCommands.has(command)) {
      return failure(
        "COMMAND_NOT_ALLOWED",
        `Command "${command}" is not allowed`,
      );
    }

    if (!Array.isArray(input.args) || input.args.some((argument) =>
      typeof argument !== "string")) {
      return failure("VALIDATION_ERROR", "Input 'args' must be an array of strings");
    }

    const args = input.args;

    const argumentError = validateArguments(command, args);
    if (argumentError) return failure("ARGUMENT_NOT_ALLOWED", argumentError);

    if (command === "find") {
      const unsafeAction = args.find((argument) =>
        unsafeFindActions.has(argument.toLowerCase()));
      if (unsafeAction) {
        return failure(
          "ARGUMENT_NOT_ALLOWED",
          `find action "${unsafeAction}" is not allowed`,
        );
      }
    }

    try {
      const result = await executeFile({
        command,
        args,
        cwd: this.cwd,
        env: safeEnvironment(this.env),
        timeoutMs: this.timeoutMs,
        signal: context.signal,
      });

      return {
        success: true,
        data: {
          stdout: truncateOutput(result.stdout, this.maxOutputBytes),
          stderr: truncateOutput(result.stderr, this.maxOutputBytes),
        },
      };
    } catch (error) {
      const details = normalizeExecutionError(error);

      return {
        success: false,
        error: {
          code: "COMMAND_FAILED",
          message: details.stderr || details.message,
          retryable: false,
          details,
        },
      };
    }
  }
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
  }
  if (command === "find" && args.some((argument) => argument === "-L" || argument === "-H")) {
    return "Following symbolic links is not allowed";
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
  if (argument.startsWith("-")) return false;
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

interface ExecuteFileOptions {
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}

function executeFile(
  options: ExecuteFileOptions,
): Promise<RunCLICommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      options.command,
      [...options.args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        signal: options.signal,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Object.assign(error, {
              stdout: stdout.trim(),
              stderr: stderr.trim(),
            }),
          );
          return;
        }

        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      },
    );
  });
}

function failure(
  code: string,
  message: string,
): CapabilityResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function normalizeExecutionError(error: unknown): {
  message: string;
  stdout: string;
  stderr: string;
} {
  if (!(error instanceof Error)) {
    return {
      message: "CLI command failed",
      stdout: "",
      stderr: "",
    };
  }

  const details = error as Error & {
    stdout?: string;
    stderr?: string;
  };

  return {
    message: error.message,
    stdout: details.stdout ?? "",
    stderr: details.stderr ?? "",
  };
}
