import { SshCapability } from "@plaios/action-ssh";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Environment,
} from "@plaios/core/domain";

import { T3McpClient, T3ToolError, type T3Client } from "./client.js";

export { T3McpClient, T3ToolError, type T3Client } from "./client.js";

export type T3Action =
  | "list_projects"
  | "open_project"
  | "launch_agent"
  | "send_message"
  | "read_thread"
  | "list_threads"
  | "clone_repo"
  | "call_tool";

export interface T3CodeInput {
  action: T3Action;
  project?: string | null;
  message?: string | null;
  title?: string | null;
  threadId?: string | null;
  branch?: string | null;
  repository?: string | null;
  destinationPath?: string | null;
  tool?: string | null;
  arguments?: Record<string, unknown> | null;
}

export interface T3CodeOutput {
  action: T3Action;
  summary: string;
  data: unknown;
}

export interface T3Project {
  id: string;
  title: string;
  workspaceRoot: string;
}

/** The slice of SshCapability used to reach the Mac. */
export interface MacShell {
  execute: SshCapability["execute"];
}

export interface T3Dashboard {
  url: string | null;
  reachable: boolean;
  projects: T3Project[];
  actions: { open(project: string): Promise<string> };
}

export interface T3CodeCapabilityOptions {
  env: Environment;
  url?: string;
  token?: string;
  macDevice?: string;
  /** SSH settings of the Mac, same keys as action-ssh; SSH_* env vars are used when absent. */
  devices?: string;
  host?: string;
  user?: string;
  port?: number;
  privateKeyPath?: string;
  privateKey?: string;
  client?: T3Client;
  mac?: MacShell;
}

const DOCS = `# control_t3_code

Drives T3 Code on the user's Mac (over Tailscale): coding agents run there, in the user's own repos.

## When to use
- "apri il progetto voya" / "open voya project": \`{"action":"open_project","project":"voya"}\` opens it in the T3 Code desktop app on the Mac.
- "fai partire un agente su voya che sistemi il login": \`{"action":"launch_agent","project":"voya","message":"<the full task>"}\`. Add \`branch\` to run it in a new git worktree instead of the project folder.
- Follow up: \`read_thread\` (latest messages) and \`send_message\` with the returned \`threadId\`. \`list_threads\` shows recent threads, of one \`project\` when given.
- \`list_projects\` when unsure of the name. \`project\` accepts a title, folder name or id; partial names work when unambiguous.
- \`clone_repo\`: \`{"action":"clone_repo","repository":"owner/name or a git URL","destinationPath":"/Users/.../name"}\`; it is registered as a project afterwards.
- Anything else T3 can do (worktrees, PRs, scheduling, answering an agent's approval request with \`t3_pending_request\`): \`{"action":"call_tool","tool":"<T3 MCP tool>","arguments":{...}}\`.

## Notes
- Agents launched from here start in approval-required mode: they may stop and wait for the user to approve edits in T3 Code.
- Write \`message\` as a complete, self-contained task: the agent does not see this conversation.
- Errors: \`PROJECT_NOT_FOUND\` / \`PROJECT_AMBIGUOUS\` (the message lists candidates; ask the user), \`T3_UNREACHABLE\` (retryable: the Mac is asleep, offline or T3 Code is closed), \`T3_TOOL_ERROR\` (T3 refused; read the message).
`;

const manifest: CapabilityManifest = {
  id: "t3code.control",
  version: "1.0.0",
  name: "control_t3_code",
  description:
    "Controls T3 Code on the user's Mac: open a project in the desktop app, launch a coding agent on a repo, follow up on its thread, list projects and threads, clone repos.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list_projects", "open_project", "launch_agent", "send_message", "read_thread", "list_threads", "clone_repo", "call_tool"],
      },
      project: { type: ["string", "null"], description: "Project title, folder name or id." },
      message: { type: ["string", "null"], description: "Task for a new agent, or a follow-up message." },
      title: { type: ["string", "null"], description: "Thread title; defaults to the message's first line." },
      threadId: { type: ["string", "null"] },
      branch: { type: ["string", "null"], description: "launch_agent: new worktree branch; omit to work in the project folder." },
      repository: { type: ["string", "null"], description: "clone_repo: owner/name or a git URL." },
      destinationPath: { type: ["string", "null"], description: "clone_repo: absolute folder on the Mac." },
      tool: { type: ["string", "null"], description: "call_tool: T3 MCP tool name." },
      arguments: { type: ["object", "null"], description: "call_tool: tool arguments." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      action: { type: "string" },
      summary: { type: "string" },
      data: {},
    },
    required: ["action", "summary", "data"],
    additionalProperties: false,
  },
  permissions: ["network.http", "network.ssh", "remote.control", "code.agents"],
  tags: ["t3", "t3code", "code", "coding", "agent", "repo", "repository", "project", "progetto", "apri", "open", "mac", "git", "clone"],
  execution: { timeoutMs: 60_000, idempotent: false },
  examples: [
    { request: "Apri il progetto voya sul Mac", arguments: { action: "open_project", project: "voya" } },
    {
      request: "Start an agent on voya to fix the failing login test",
      arguments: { action: "launch_agent", project: "voya", message: "Find and fix the failing login test, then run the test suite." },
    },
  ],
};

export class T3CodeCapability implements Capability<T3CodeInput, T3CodeOutput> {
  readonly manifest = manifest;

  private readonly client: T3Client;
  private readonly mac: MacShell;
  private readonly macDevice: string | null;
  private readonly url: string | null;

  constructor(options: T3CodeCapabilityOptions) {
    const url = options.url ?? options.env.get("T3_MCP_URL");
    const token = options.token ?? options.env.get("T3_MCP_TOKEN");
    if (!options.client && (!url || !token)) {
      throw new Error("T3_MCP_URL and T3_MCP_TOKEN are required for T3CodeCapability");
    }
    this.url = url ?? null;
    this.client = options.client ?? new T3McpClient(url!, token!);
    const { env, devices, host, user, port, privateKeyPath, privateKey } = options;
    this.mac = options.mac ?? new SshCapability({ env, devices, host, user, port, privateKeyPath, privateKey });
    this.macDevice = options.macDevice ?? options.env.get("T3_SSH_DEVICE") ?? null;
  }

  async microfrontendData(): Promise<T3Dashboard> {
    const projects = await this.projects().catch(() => null);
    return {
      url: this.url,
      reachable: projects !== null,
      projects: projects ?? [],
      actions: {
        open: async (project) => {
          const result = await this.execute({ action: "open_project", project }, { runId: "ui", callId: "ui", startedAt: new Date() });
          if (!result.success) throw new Error(result.error.message);
          return result.data.summary;
        },
      },
    };
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  async execute(input: T3CodeInput, context: CapabilityExecutionContext): Promise<CapabilityResult<T3CodeOutput>> {
    try {
      return await this.run(input, context);
    } catch (error) {
      if (error instanceof InputError) return failure(error.code, error.message, false);
      if (error instanceof T3ToolError) return failure("T3_TOOL_ERROR", error.message, false);
      return failure("T3_UNREACHABLE", `T3 Code is not reachable: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private async run(input: T3CodeInput, context: CapabilityExecutionContext): Promise<CapabilityResult<T3CodeOutput>> {
    const { action } = input;
    switch (action) {
      case "list_projects": {
        const projects = await this.projects();
        return done(action, `${projects.length} projects: ${projects.map((p) => p.title).join(", ")}.`, projects);
      }
      case "open_project": {
        const project = resolveProject(await this.projects(), required(input.project, "project"));
        const opened = await this.mac.execute(
          { action: "exec", deviceId: this.macDevice, command: openCommand(project.workspaceRoot) },
          context,
        );
        if (!opened.success) return opened;
        // A failed remote command is still a successful SSH call; only the marker proves `t3 app` worked.
        if (!opened.data.stdout.includes(OPENED_MARKER)) {
          return failure("OPEN_FAILED", `Could not open ${project.title} on the Mac: ${opened.data.stderr || opened.data.summary}`, true);
        }
        return done(action, `Opened ${project.title} in T3 Code on the Mac.`, project);
      }
      case "launch_agent": {
        const project = resolveProject(await this.projects(), required(input.project, "project"));
        const message = required(input.message, "message");
        const branch = input.branch?.trim();
        const launched = await this.client.call("t3_thread_launch", {
          projectId: project.id,
          title: input.title?.trim() || message.split("\n")[0]!.slice(0, 80),
          message,
          ...(branch ? { workspaceStrategy: { type: "worktree", branch } } : {}),
          clientRequestId: `${context.runId}:${context.callId}`,
        });
        return done(action, `Agent started on ${project.title}${branch ? ` (worktree ${branch})` : ""}.`, launched);
      }
      case "send_message": {
        const sent = await this.client.call("t3_thread_send", {
          threadId: required(input.threadId, "threadId"),
          message: required(input.message, "message"),
          mode: "auto",
        });
        return done(action, "Message sent.", sent);
      }
      case "read_thread": {
        const thread = await this.client.call("t3_thread_read", {
          threadId: required(input.threadId, "threadId"),
          limit: 10,
          maxCharsPerItem: 4_000,
        });
        return done(action, "Latest messages of the thread.", thread);
      }
      case "list_threads": {
        const project = input.project?.trim() ? resolveProject(await this.projects(), input.project) : undefined;
        const threads = await this.client.call("t3_thread_list", {
          ...(project ? { projectId: project.id } : { allProjects: true }),
          limit: 20,
        });
        return done(action, project ? `Recent threads of ${project.title}.` : "Recent threads.", threads);
      }
      case "clone_repo": {
        const repository = required(input.repository, "repository");
        const destinationPath = required(input.destinationPath, "destinationPath");
        const cloned = await this.client.call("t3_project_clone", {
          ...(/^(https?:\/\/|git@|ssh:\/\/)/.test(repository) ? { remoteUrl: repository } : { repository }),
          destinationPath,
        });
        const project = await this.client.call("t3_project_create", {
          title: destinationPath.split("/").filter(Boolean).pop()!,
          workspaceRoot: destinationPath,
        });
        return done(action, `Cloned ${repository} into ${destinationPath} and added it as a project.`, { cloned, project });
      }
      case "call_tool": {
        const tool = required(input.tool, "tool");
        return done(action, `${tool} done.`, await this.client.call(tool, input.arguments ?? {}));
      }
      default:
        return failure("VALIDATION_ERROR", `Unknown action ${String(action)}`, false);
    }
  }

  private async projects(): Promise<T3Project[]> {
    const result = (await this.client.call("t3_project_list", { limit: 100 })) as { projects?: T3Project[] };
    return (result.projects ?? []).map(({ id, title, workspaceRoot }) => ({ id, title, workspaceRoot }));
  }
}

/** Exact id, title or folder name first, then a unique partial match. */
export function resolveProject(projects: readonly T3Project[], query: string): T3Project {
  const needle = query.trim().toLowerCase();
  const folder = (p: T3Project) => p.workspaceRoot.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  const exact = projects.filter((p) => p.id === query.trim() || p.title.toLowerCase() === needle || folder(p) === needle);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length ? exact : projects.filter((p) => p.title.toLowerCase().includes(needle) || folder(p).includes(needle));
  if (partial.length === 1) return partial[0]!;
  if (!partial.length) {
    throw new InputError("PROJECT_NOT_FOUND", `No T3 project matches "${query}". Projects: ${projects.map((p) => p.title).join(", ")}.`);
  }
  throw new InputError("PROJECT_AMBIGUOUS", `"${query}" matches ${partial.map((p) => `${p.title} (${p.workspaceRoot})`).join(", ")}.`);
}

/** `t3 app` talks to the desktop app's local socket and refuses inside SSH sessions, so drop the SSH markers. */
export function openCommand(workspaceRoot: string): string {
  return `env -u SSH_CONNECTION -u SSH_TTY -u SSH_CLIENT "$HOME/.t3/bin/t3" app '${workspaceRoot.replaceAll("'", `'\\''`)}' && echo ${OPENED_MARKER}`;
}

const OPENED_MARKER = "T3_APP_OPENED";

class InputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function required(value: string | null | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new InputError("VALIDATION_ERROR", `Input '${name}' is required`);
  return trimmed;
}

function done(action: T3Action, summary: string, data: unknown): CapabilityResult<T3CodeOutput> {
  return { success: true, data: { action, summary, data } };
}

function failure(code: string, message: string, retryable: boolean): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable } };
}
