import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import { CRONJOB_OPENUI } from "../web/input/openui.js";
import type {
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Database,
  DatabaseRecord,
  InputInterface,
  InputListener,
  InputMessage,
} from "@plaios/core/domain";

const TABLE = "jobs";

export type CronjobStatus = "active" | "suspended";

export interface Cronjob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  timezone: string;
  preferredOutputChannel?: string;
  status: CronjobStatus;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
}

export interface AddCronjobOptions {
  name: string;
  cronExpression: string;
  prompt: string;
  timezone?: string;
  preferredOutputChannel?: string;
}

export interface CronScheduler {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: {
      name?: string;
      timezone?: string;
      noOverlap?: boolean;
    },
  ): ScheduledTask;
}

export interface CronjobAdapterOptions {
  database: Database;
  scheduler?: CronScheduler;
  /** Scheduled runs act as this user so they can recall that user's memory. */
  userId?: string;
  defaultTimezone?: string;
  preferredOutputChannel?: string;
  maxJobs?: number;
  allowSeconds?: boolean;
}

export type ManageCronjobsAction =
  | "add"
  | "list"
  | "suspend"
  | "resume"
  | "remove";

export interface ManageCronjobsInput {
  action: ManageCronjobsAction;
  idOrName: string | null;
  name: string | null;
  cronExpression: string | null;
  prompt: string | null;
  timezone: string | null;
  preferredOutputChannel: string | null;
}

export interface ManageCronjobsOutput {
  message: string;
  job: Cronjob | null;
  jobs: Cronjob[];
}

export interface CronjobMicrofrontendData {
  channel: string;
  listening: boolean;
  activeCount: number;
  jobs: Cronjob[];
  policy: {
    defaultTimezone: string;
    preferredOutputChannel?: string;
    maxJobs: number;
    allowSeconds: boolean;
  };
  actions: {
    refresh(): Promise<CronjobMicrofrontendData>;
    add(options: AddCronjobOptions): Promise<CronjobMicrofrontendData>;
    suspend(idOrName: string): Promise<CronjobMicrofrontendData>;
    resume(idOrName: string): Promise<CronjobMicrofrontendData>;
    remove(idOrName: string): Promise<CronjobMicrofrontendData>;
  };
}

const DOCS = `# manage_cronjobs

Adds, lists, suspends, resumes and removes persistent scheduled prompts. At each tick an active job sends its \`prompt\` into the normal agent pipeline (acting as the configured user, so it can recall that user's memory) and the answer goes to its preferred output channel. Jobs survive restarts.

## When to use
- The user wants something recurring or at a fixed time: "ogni mattina alle 8 mandami il meteo", "every Monday summarize ...", reminders.
- To just show the user's jobs, write the \`CronjobList\` chat component instead of calling \`list\`; it lets the user pause, resume, edit and remove them. Use \`list\` when you need the data yourself (ids, prompts).
- Not for doing the task now: answer directly, and only schedule it if asked.

## Inputs
Every field is required; set the ones the action does not use to null.
- \`{"action": "add", "idOrName": null, "name": "morning-weather", "cronExpression": "0 8 * * *", "prompt": "Dimmi il meteo di oggi a Treviso.", "timezone": null, "preferredOutputChannel": null}\`
- \`{"action": "suspend", "idOrName": "morning-weather", "name": null, "cronExpression": null, "prompt": null, "timezone": null, "preferredOutputChannel": null}\`
Write \`prompt\` as a self-contained instruction for a future run that has no chat context. There is no edit action: to change a job, remove it and add it again.

## Limits and failures
- Five-field cron only (minute hour day month weekday); second-level schedules are rejected unless enabled. Times use the IANA \`timezone\` (default from config).
- Names must be unique (case-insensitive, \`CRONJOB_ALREADY_EXISTS\` / \`CRONJOB_OPERATION_FAILED\`); the job count is capped (default 100).
- \`remove\` is permanent: confirm with the user before removing jobs they did not name explicitly.
`;

const manifest: CapabilityManifest = {
  id: "cronjobs.manage",
  version: "1.0.0",
  name: "manage_cronjobs",
  description:
    "Adds, lists, suspends, resumes, or removes persistent scheduled prompts. Active jobs enter the normal AgentOS input pipeline at the configured time.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "suspend", "resume", "remove"],
      },
      idOrName: {
        type: ["string", "null"],
        description:
          "Job ID or exact name for suspend, resume, or remove; otherwise null.",
      },
      name: {
        type: ["string", "null"],
        description: "Unique job name for add; otherwise null.",
      },
      cronExpression: {
        type: ["string", "null"],
        description: "Standard five-field cron expression for add; otherwise null.",
      },
      prompt: {
        type: ["string", "null"],
        description: "Agent prompt to run on schedule for add; otherwise null.",
      },
      timezone: {
        type: ["string", "null"],
        description: "IANA timezone, or null to use the configured default.",
      },
      preferredOutputChannel: {
        type: ["string", "null"],
        description:
          "Preferred output channel, or null to use the configured default.",
      },
    },
    required: [
      "action",
      "idOrName",
      "name",
      "cronExpression",
      "prompt",
      "timezone",
      "preferredOutputChannel",
    ],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      job: { type: ["object", "null"], additionalProperties: true },
      jobs: {
        type: "array",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["message", "job", "jobs"],
    additionalProperties: false,
  },
  permissions: ["cronjobs.read", "cronjobs.write"],
  tags: [
    "cron",
    "cronjob",
    "schedule",
    "automation",
    "recurring",
    "reminder",
    "suspend",
    "resume",
  ],
  execution: { timeoutMs: 5_000, idempotent: false },
  examples: [
    {
      request: "Every weekday at 9 AM, research the latest AI news",
      arguments: {
        action: "add",
        idOrName: null,
        name: "weekday-ai-news",
        cronExpression: "0 9 * * 1-5",
        prompt: "Research the latest AI news and summarize it.",
        timezone: "Europe/Rome",
        preferredOutputChannel: "telegram",
      },
    },
  ],
};

/** A single live instance serves both the cron input and cronjobs.manage tool. */
export class CronjobAdapter
  implements InputInterface, Capability<ManageCronjobsInput, ManageCronjobsOutput>
{
  readonly channel = "cronjob" as const;
  readonly manifest = manifest;

  private readonly database: Database;
  private readonly scheduler: CronScheduler;
  private readonly ready: Promise<void>;
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly defaultTimezone: string;
  private readonly preferredOutputChannel?: string;
  private readonly maxJobs: number;
  private readonly allowSeconds: boolean;
  private readonly userId?: string;
  private listening = false;
  private listener?: InputListener;
  private resolveStopped?: () => void;
  private stopped?: Promise<void>;

  constructor(options: CronjobAdapterOptions) {
    if (!options.database) throw new Error("CronjobAdapter requires database");
    this.database = options.database;
    this.scheduler = options.scheduler ?? cron;
    this.defaultTimezone = optionalText(options.defaultTimezone) ?? "UTC";
    this.preferredOutputChannel = optionalText(options.preferredOutputChannel);
    this.maxJobs = positiveInteger(options.maxJobs, 100, "maxJobs");
    this.allowSeconds = options.allowSeconds ?? false;
    this.userId = options.userId;
    validateTimezone(this.defaultTimezone);
    this.ready = this.initializeDatabase();
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) throw new Error("CronjobAdapter listener is already running");
    this.listening = true;
    this.listener = listener;
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
    try {
      for (const job of await this.listCronjobs()) {
        if (job.status === "active") this.scheduleJob(job);
      }
      await this.stopped;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.listening = false;
    for (const task of this.tasks.values()) task.destroy();
    this.tasks.clear();
    this.listener = undefined;
    this.resolveStopped?.();
    this.resolveStopped = undefined;
    this.stopped = undefined;
  }

  close(): Promise<void> {
    return this.stop();
  }

  async execute(
    input: ManageCronjobsInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<ManageCronjobsOutput>> {
    if (context.signal?.aborted) {
      return failure("CRONJOB_ABORTED", "Cron job operation was aborted");
    }
    try {
      switch (input.action) {
        case "add": {
          const job = await this.addCronjob({
            name: requiredText(input.name, "name"),
            cronExpression: requiredText(input.cronExpression, "cronExpression"),
            prompt: requiredText(input.prompt, "prompt"),
            timezone: input.timezone ?? undefined,
            preferredOutputChannel: input.preferredOutputChannel ?? undefined,
          });
          return success(`Cron job "${job.name}" added`, job);
        }
        case "list": {
          const jobs = await this.listCronjobs();
          return {
            success: true,
            data: {
              message: `${jobs.length} cron job${jobs.length === 1 ? "" : "s"} found`,
              job: null,
              jobs,
            },
          };
        }
        case "suspend":
          return this.changeExisting(input.idOrName, "suspended", (target) =>
            this.suspendCronjob(target),
          );
        case "resume":
          return this.changeExisting(input.idOrName, "resumed", (target) =>
            this.resumeCronjob(target),
          );
        case "remove":
          return this.changeExisting(input.idOrName, "removed", (target) =>
            this.removeCronjob(target),
          );
        default:
          return failure(
            "VALIDATION_ERROR",
            `Unsupported cron job action: ${String(input.action)}`,
          );
      }
    } catch (error) {
      return failure(
        isConstraintError(error)
          ? "CRONJOB_ALREADY_EXISTS"
          : "CRONJOB_OPERATION_FAILED",
        error instanceof Error ? error.message : "Cron job operation failed",
      );
    }
  }

  uiComponents() {
    return [CRONJOB_OPENUI];
  }

  docs(): string {
    return DOCS;
  }

  async microfrontendData(): Promise<CronjobMicrofrontendData> {
    const jobs = await this.listCronjobs();
    return {
      channel: this.channel,
      listening: this.listening,
      activeCount: jobs.filter(({ status }) => status === "active").length,
      jobs,
      policy: {
        defaultTimezone: this.defaultTimezone,
        preferredOutputChannel: this.preferredOutputChannel,
        maxJobs: this.maxJobs,
        allowSeconds: this.allowSeconds,
      },
      actions: {
        refresh: () => this.microfrontendData(),
        add: async (options) => {
          await this.addCronjob(options);
          return this.microfrontendData();
        },
        suspend: async (target) => {
          await this.requireJobChange(target, (value) => this.suspendCronjob(value));
          return this.microfrontendData();
        },
        resume: async (target) => {
          await this.requireJobChange(target, (value) => this.resumeCronjob(value));
          return this.microfrontendData();
        },
        remove: async (target) => {
          await this.requireJobChange(target, (value) => this.removeCronjob(value));
          return this.microfrontendData();
        },
      },
    };
  }

  async addCronjob(options: AddCronjobOptions): Promise<Cronjob> {
    const name = requiredText(options.name, "name");
    const cronExpression = requiredText(options.cronExpression, "cronExpression");
    const prompt = requiredText(options.prompt, "prompt");
    const timezone = optionalText(options.timezone) ?? this.defaultTimezone;
    const preferredOutputChannel =
      optionalText(options.preferredOutputChannel) ?? this.preferredOutputChannel;
    this.validateSchedule(cronExpression, timezone);
    const jobs = await this.listCronjobs();
    if (jobs.length >= this.maxJobs) {
      throw new Error(`Cron job limit reached (${this.maxJobs})`);
    }
    if (jobs.some((job) => job.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Cron job name must be unique: "${name}"`);
    }
    const now = new Date().toISOString();
    const job: Cronjob = {
      id: `cronjob-${randomUUID()}`,
      name,
      cronExpression,
      prompt,
      timezone,
      preferredOutputChannel,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.database.add<CronjobRow>(TABLE, toRow(job));
    if (this.listening) this.scheduleJob(job);
    return job;
  }

  async listCronjobs(): Promise<Cronjob[]> {
    await this.ready;
    const rows = await this.database.get<CronjobRow>(TABLE, {
      orderBy: [{ field: "createdAt", direction: "asc" }],
    });
    return rows.map(mapRow);
  }

  async removeCronjob(idOrName: string): Promise<Cronjob | undefined> {
    const job = await this.getCronjob(idOrName);
    if (!job) return undefined;
    this.destroyTask(job.id);
    await this.database.delete(TABLE, job.id);
    return job;
  }

  async suspendCronjob(idOrName: string): Promise<Cronjob | undefined> {
    const job = await this.getCronjob(idOrName);
    if (!job) return undefined;
    this.destroyTask(job.id);
    await this.updateStatus(job.id, "suspended");
    return this.getCronjob(job.id);
  }

  async resumeCronjob(idOrName: string): Promise<Cronjob | undefined> {
    const job = await this.getCronjob(idOrName);
    if (!job) return undefined;
    this.validateSchedule(job.cronExpression, job.timezone);
    await this.updateStatus(job.id, "active");
    const resumed = await this.getCronjob(job.id);
    if (resumed && this.listening) this.scheduleJob(resumed);
    return resumed;
  }

  private initializeDatabase(): Promise<void> {
    return this.database.init({
      tables: {
        [TABLE]: {
          primaryKey: "id",
          columns: {
            id: { type: "string", required: true },
            name: { type: "string", required: true, unique: true },
            cronExpression: { type: "string", required: true },
            prompt: { type: "string", required: true },
            timezone: { type: "string", required: true },
            preferredOutputChannel: { type: "string" },
            status: { type: "string", required: true },
            createdAt: { type: "datetime", required: true },
            updatedAt: { type: "datetime", required: true },
            lastRunAt: { type: "datetime" },
            lastError: { type: "string" },
          },
          indexes: [{ columns: ["status", "createdAt"] }],
        },
      },
    });
  }

  private async getCronjob(idOrName: string): Promise<Cronjob | undefined> {
    const target = requiredText(idOrName, "idOrName");
    await this.ready;
    const byId = await this.database.get<CronjobRow>(TABLE, target);
    if (byId) return mapRow(byId);
    const jobs = await this.listCronjobs();
    return jobs.find((job) => job.name.toLowerCase() === target.toLowerCase());
  }

  private validateSchedule(expression: string, timezone: string): void {
    const fieldCount = expression.trim().split(/\s+/).length;
    if (fieldCount !== 5 && !(this.allowSeconds && fieldCount === 6)) {
      throw new Error(
        this.allowSeconds
          ? "Cron expression must contain five or six fields"
          : "Cron expression must contain exactly five fields; second-level schedules are disabled",
      );
    }
    if (!this.scheduler.validate(expression)) {
      throw new Error(`Invalid cron expression: "${expression}"`);
    }
    validateTimezone(timezone);
  }

  private scheduleJob(job: Cronjob): void {
    this.destroyTask(job.id);
    const task = this.scheduler.schedule(
      job.cronExpression,
      () => this.runJob(job.id),
      { name: job.id, timezone: job.timezone, noOverlap: true },
    );
    this.tasks.set(job.id, task);
  }

  private async runJob(id: string): Promise<void> {
    const job = await this.getCronjob(id);
    const listener = this.listener;
    if (!this.listening || !listener || job?.status !== "active") return;
    const lastRunAt = new Date();
    await this.database.update<CronjobRow>(TABLE, job.id, {
      lastRunAt,
      lastError: null,
      updatedAt: lastRunAt,
    });
    try {
      await listener(this.createMessage(job, lastRunAt));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cron job execution failed";
      await this.database.update<CronjobRow>(TABLE, job.id, {
        lastError: message,
        updatedAt: new Date(),
      });
    }
  }

  private createMessage(job: Cronjob, triggeredAt: Date): InputMessage {
    return {
      id: `input-${randomUUID()}`,
      channel: this.channel,
      sessionId: `cronjob-${job.id}`,
      ...(this.userId ? { userId: this.userId } : {}),
      text: scheduledPromptText(job, triggeredAt),
      createdAt: triggeredAt,
      metadata: {
        preferredOutputChannel: job.preferredOutputChannel,
        cronjob: {
          id: job.id,
          name: job.name,
          cronExpression: job.cronExpression,
          timezone: job.timezone,
          triggeredAt: triggeredAt.toISOString(),
        },
      },
    };
  }

  private async updateStatus(id: string, status: CronjobStatus): Promise<void> {
    await this.database.update<CronjobRow>(TABLE, id, {
      status,
      updatedAt: new Date(),
      lastError: null,
    });
  }

  private destroyTask(id: string): void {
    this.tasks.get(id)?.destroy();
    this.tasks.delete(id);
  }

  private async changeExisting(
    idOrName: string | null,
    verb: string,
    change: (target: string) => Promise<Cronjob | undefined>,
  ): Promise<CapabilityResult<ManageCronjobsOutput>> {
    const target = requiredText(idOrName, "idOrName");
    const job = await change(target);
    return job
      ? success(`Cron job "${job.name}" ${verb}`, job)
      : failure("CRONJOB_NOT_FOUND", `Cron job "${target}" was not found`);
  }

  private async requireJobChange(
    target: string,
    change: (value: string) => Promise<Cronjob | undefined>,
  ): Promise<void> {
    const normalized = requiredText(target, "idOrName");
    if (!await change(normalized)) {
      throw new Error(`Cron job "${normalized}" was not found`);
    }
  }
}

interface CronjobRow extends DatabaseRecord {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  timezone: string;
  preferredOutputChannel: string | null;
  status: CronjobStatus;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  lastError: string | null;
}

function mapRow(row: CronjobRow): Cronjob {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cronExpression,
    prompt: row.prompt,
    timezone: row.timezone,
    preferredOutputChannel: row.preferredOutputChannel ?? undefined,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    lastRunAt: row.lastRunAt ? new Date(row.lastRunAt).toISOString() : undefined,
    lastError: row.lastError ?? undefined,
  };
}

function toRow(job: Cronjob): CronjobRow {
  return {
    id: job.id,
    name: job.name,
    cronExpression: job.cronExpression,
    prompt: job.prompt,
    timezone: job.timezone,
    preferredOutputChannel: job.preferredOutputChannel ?? null,
    status: job.status,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    lastRunAt: job.lastRunAt ? new Date(job.lastRunAt) : null,
    lastError: job.lastError ?? null,
  };
}

/**
 * Frames the stored prompt as a trigger to execute now. Sent raw, a prompt like
 * "Every evening do X" reads as the user stating a preference, and the agent
 * replies "I'll keep that in mind" instead of doing X.
 */
function scheduledPromptText(job: Cronjob, triggeredAt: Date): string {
  const localTime = new Intl.DateTimeFormat("it-IT", {
    timeZone: job.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(triggeredAt);
  return [
    `[Scheduled job "${job.name}" triggered at ${localTime} (${job.timezone})]`,
    "This is an automatic trigger, not a message from the user. Carry out the",
    "instructions below now, for this run, and reply with only the result to",
    "deliver to the user. Do not acknowledge, save, or reschedule the instructions.",
    "",
    "Instructions:",
    job.prompt,
  ].join("\n");
}

function requiredText(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Input '${field}' is required`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return normalized;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: "${timezone}"`);
  }
}

function success(
  message: string,
  job: Cronjob,
): CapabilityResult<ManageCronjobsOutput> {
  return { success: true, data: { message, job, jobs: [] } };
}

function failure(code: string, message: string): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}
