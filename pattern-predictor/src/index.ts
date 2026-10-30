import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask } from "node-cron";
import type {
  AIFunctionDefinition,
  Capability,
  CapabilityExecutionContext,
  CapabilityManifest,
  CapabilityResult,
  Database,
  DatabaseRecord,
  InputInterface,
  InputListener,
  InputMessage,
  Memory,
  System2,
} from "@plaios/core/domain";

const TABLE = "predictions";
const CHAT_NAMESPACE = "chat-history";
const DAY_MINUTES = 24 * 60;
const MAX_MESSAGES = 1_000;
const MAX_IGNORED = 3;
const REPLY_WINDOW_MS = 2 * 60 * 60 * 1_000;
const DONE_WINDOW_MS = 3 * 60 * 60 * 1_000;
/** Runs stored before messages carried `proactive` are recognised by their channel. */
const PROACTIVE_CHANNELS = new Set(["cronjob", "pattern-predictor"]);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WORK_DAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

export type PredictionStatus = "active" | "dismissed" | "promoted" | "muted";

export interface Prediction {
  id: string;
  key: string;
  description: string;
  actionPrompt: string;
  /** Usual local time, in minutes after midnight. */
  minuteOfDay: number;
  weekdays: number[];
  timezone: string;
  /** Different days the request was seen on. */
  occurrences: number;
  status: PredictionStatus;
  ignoredCount: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastAskedAt?: string;
}

export interface CronScheduler {
  validate(expression: string): boolean;
  schedule(
    expression: string,
    callback: () => void | Promise<void>,
    options?: { name?: string; timezone?: string; noOverlap?: boolean },
  ): ScheduledTask;
}

export interface PatternPredictorOptions {
  database: Database;
  memory: Memory;
  system2: System2;
  userId: string;
  outputChannel: string;
  scheduler?: CronScheduler;
  timezone?: string;
  analysisCron?: string;
  lookbackDays?: number;
  minDays?: number;
  windowMinutes?: number;
  leadMinutes?: number;
  clock?: () => Date;
}

export type ManagePredictionsAction =
  | "list"
  | "add"
  | "remove"
  | "check"
  | "dismiss"
  | "resume"
  | "promote"
  | "analyze";

export interface ManagePredictionsInput {
  action: ManagePredictionsAction;
  idOrKey: string | null;
  /** What the user asks; for `check`, the topic to look for in the history. */
  description: string | null;
  actionPrompt: string | null;
  /** Usual local time, HH:MM. */
  time: string | null;
  /** Cron weekday field: "*", "1-5", "0,6" or a list like "1,3,5". */
  weekdays: string | null;
}

export interface AddPredictionOptions {
  key?: string;
  description: string;
  actionPrompt: string;
  time: string;
  weekdays?: string;
}

export interface ManagePredictionsOutput {
  message: string;
  prediction: Prediction | null;
  predictions: Prediction[];
}

export interface LocalTime {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** 0 = Sunday, like cron. */
  weekday: number;
  minute: number;
}

export interface RecurringSlot {
  minute: number;
  days: number;
  weekdays: number[];
}

interface ChatMessage {
  id: string;
  text: string;
  createdAt: Date;
}

export interface PatternCheck {
  messages: number;
  days: number;
  /** Busiest ±window slot, even when it does not qualify. */
  time?: string;
  slotDays: number;
  weekdays: number[];
  qualifies: boolean;
  examples: string[];
}

interface PatternReport {
  patterns: Array<{
    key: string;
    description: string;
    actionPrompt: string;
    messages: number[];
  }>;
}

const DOCS = `# manage_predictions

The pattern predictor reads the user's chat history every night, finds requests and activities they repeat at about the same time of day (turning off the lights around midnight, working on new video ideas in the evening) and, a few minutes before that time, asks them whether to do it. This tool manages those predictions.

## When to use
- The user says to stop a suggestion ("non chiedermelo più", "stop asking about the lights"): \`list\`, then \`dismiss\` the matching one.
- The user wants it done automatically every time ("fallo sempre"): create a cronjob with \`manage_cronjobs\` using the prediction's \`actionPrompt\` and time, then \`promote\` the prediction so it stops asking.
- The user asks what habits you noticed: \`list\`. To re-scan the whole history now: \`analyze\`.
- The user asks whether something is a pattern ("hai notato che ti chiedo spesso idee per i video?"): \`check\` with that topic as \`description\`. It reports on how many days and at what time it appears and whether it qualifies; if the user wants it, \`add\` it with the reported time.
- The user wants a suggestion at a time of their choice: \`add\`. To delete one for good: \`remove\` (prefer \`dismiss\` when they only want it to stop asking, so analysis does not learn it again).
- When the user just answers "sì" to a suggestion, do the action itself; do not call this tool.

## Inputs
Every field is required; set the ones the action does not use to null.
- \`{"action": "list", "idOrKey": null, "description": null, "actionPrompt": null, "time": null, "weekdays": null}\` (also \`analyze\`)
- \`{"action": "dismiss", "idOrKey": "lights-off-night", "description": null, "actionPrompt": null, "time": null, "weekdays": null}\` (also \`resume\`, \`promote\`, \`remove\`)
- \`{"action": "check", "idOrKey": null, "description": "chiedere idee per nuovi video TikTok", "actionPrompt": null, "time": null, "weekdays": null}\`
- \`{"action": "add", "idOrKey": "video-ideas-evening", "description": "lavorare a nuove idee per i video", "actionPrompt": "Proponi tre idee per il prossimo video TikTok.", "time": "22:15", "weekdays": "*"}\` (\`idOrKey\` is the optional key)

## Limits
- Analysis and \`check\` only accept time-of-day habits repeated on at least 3 different days in the last 21 days (by default), within ±30 minutes.
- A prediction left unanswered 3 times in a row is muted automatically; \`resume\` turns it back on.
`;

const manifest: CapabilityManifest = {
  id: "predictions.manage",
  version: "1.0.0",
  name: "manage_predictions",
  description:
    "Lists, adds, removes, checks, dismisses, resumes, promotes, or re-analyses the habits the pattern predictor learns from chat history and offers proactively.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "add", "remove", "check", "dismiss", "resume", "promote", "analyze"] },
      idOrKey: { type: ["string", "null"], description: "Prediction id or key; for add, an optional key." },
      description: { type: ["string", "null"], description: "add: what the user asks; check: the topic to look for." },
      actionPrompt: { type: ["string", "null"], description: "add: self-contained instruction run when the user says yes." },
      time: { type: ["string", "null"], description: "add: usual local time, HH:MM." },
      weekdays: { type: ["string", "null"], description: "add: cron weekday field, default \"*\"." },
    },
    required: ["action", "idOrKey", "description", "actionPrompt", "time", "weekdays"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
      prediction: { type: ["object", "null"], additionalProperties: true },
      predictions: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    required: ["message", "prediction", "predictions"],
    additionalProperties: false,
  },
  permissions: ["predictions.read", "predictions.write"],
  tags: ["prediction", "habit", "pattern", "proactive", "suggestion", "dismiss"],
  execution: { timeoutMs: 120_000, idempotent: false },
  examples: [
    {
      request: "Non chiedermi più se spegnere le luci",
      arguments: { action: "dismiss", idOrKey: "lights-off-night", description: null, actionPrompt: null, time: null, weekdays: null },
    },
    {
      request: "Hai notato che ti chiedo spesso idee per i video?",
      arguments: { action: "check", idOrKey: null, description: "chiedere idee per nuovi video", actionPrompt: null, time: null, weekdays: null },
    },
  ],
};

const REPORT_FUNCTION: AIFunctionDefinition<PatternReport> = {
  name: "report_patterns",
  description: "Report groups of messages that ask for the same recurring action.",
  inputSchema: {
    type: "object",
    properties: {
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "kebab-case id; reuse a known key for the same habit" },
            description: { type: "string", description: "What the user asks, short, in the user's language" },
            actionPrompt: { type: "string", description: "Self-contained instruction that performs the action" },
            messages: { type: "array", items: { type: "integer" }, description: "Numbers of every message in the group" },
          },
          required: ["key", "description", "actionPrompt", "messages"],
          additionalProperties: false,
        },
      },
    },
    required: ["patterns"],
    additionalProperties: false,
  },
  strict: true,
};

const CHECK_FUNCTION: AIFunctionDefinition<{ messages: number[] }> = {
  name: "report_matches",
  description: "Report the messages about the topic.",
  inputSchema: {
    type: "object",
    properties: {
      messages: { type: "array", items: { type: "integer" }, description: "Numbers of the matching messages" },
    },
    required: ["messages"],
    additionalProperties: false,
  },
  strict: true,
};

/** One live instance is both the proactive input and the predictions.manage tool. */
export class PatternPredictorAdapter
  implements InputInterface, Capability<ManagePredictionsInput, ManagePredictionsOutput>
{
  readonly channel = "pattern-predictor" as const;
  readonly manifest = manifest;

  private readonly database: Database;
  private readonly memory: Memory;
  private readonly system2: System2;
  private readonly scheduler: CronScheduler;
  private readonly userId: string;
  private readonly outputChannel: string;
  private readonly timezone: string;
  private readonly analysisCron: string;
  private readonly lookbackDays: number;
  private readonly minDays: number;
  private readonly windowMinutes: number;
  private readonly leadMinutes: number;
  private readonly clock: () => Date;
  private readonly ready: Promise<void>;
  private readonly tasks = new Map<string, ScheduledTask>();
  private listening = false;
  private listener?: InputListener;
  private resolveStopped?: () => void;
  private stopped?: Promise<void>;

  constructor(options: PatternPredictorOptions) {
    if (!options.database) throw new Error("PatternPredictorAdapter requires database");
    if (!options.memory) throw new Error("PatternPredictorAdapter requires memory");
    if (!options.system2) throw new Error("PatternPredictorAdapter requires system2");
    this.database = options.database;
    this.memory = options.memory;
    this.system2 = options.system2;
    this.scheduler = options.scheduler ?? cron;
    this.userId = requiredText(options.userId, "userId");
    this.outputChannel = requiredText(options.outputChannel, "outputChannel");
    this.timezone = options.timezone?.trim() || "Europe/Rome";
    this.analysisCron = options.analysisCron?.trim() || "0 4 * * *";
    this.lookbackDays = positiveInteger(options.lookbackDays, 21, "lookbackDays");
    this.minDays = positiveInteger(options.minDays, 3, "minDays");
    this.windowMinutes = positiveInteger(options.windowMinutes, 30, "windowMinutes");
    this.leadMinutes = positiveInteger(options.leadMinutes, 5, "leadMinutes");
    this.clock = options.clock ?? (() => new Date());
    localTime(new Date(), this.timezone);
    if (!this.scheduler.validate(this.analysisCron)) {
      throw new Error(`Invalid analysisCron: "${this.analysisCron}"`);
    }
    this.ready = this.initializeDatabase();
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) throw new Error("PatternPredictorAdapter listener is already running");
    this.listening = true;
    this.listener = listener;
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
    try {
      this.tasks.set("analysis", this.scheduler.schedule(
        this.analysisCron,
        () => this.analyze().then(() => undefined, (error: unknown) =>
          console.warn("[pattern-predictor] Analysis failed:", error)),
        { name: "pattern-analysis", timezone: this.timezone, noOverlap: true },
      ));
      await this.reschedule();
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
    input: ManagePredictionsInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult<ManagePredictionsOutput>> {
    if (context.signal?.aborted) return failure("PREDICTION_ABORTED", "Prediction operation was aborted");
    try {
      switch (input.action) {
        case "list": {
          const predictions = await this.listPredictions();
          return result(`${predictions.length} prediction${predictions.length === 1 ? "" : "s"} found`, null, predictions);
        }
        case "add": {
          const prediction = await this.addPrediction({
            key: input.idOrKey ?? undefined,
            description: requiredText(input.description, "description"),
            actionPrompt: requiredText(input.actionPrompt, "actionPrompt"),
            time: requiredText(input.time, "time"),
            weekdays: input.weekdays ?? undefined,
          });
          return result(`Prediction "${prediction.key}" added`, prediction, []);
        }
        case "remove": {
          const target = requiredText(input.idOrKey, "idOrKey");
          const prediction = await this.removePrediction(target);
          return prediction
            ? result(`Prediction "${prediction.key}" removed`, prediction, [])
            : failure("PREDICTION_NOT_FOUND", `Prediction "${target}" was not found`);
        }
        case "check": {
          const topic = requiredText(input.description, "description");
          return result(describeCheck(topic, await this.check(topic), this.minDays, this.lookbackDays), null, []);
        }
        case "analyze": {
          const predictions = await this.analyze();
          return result(`Analysis done: ${predictions.filter(({ status }) => status === "active").length} active prediction(s)`, null, predictions);
        }
        case "dismiss":
        case "resume":
        case "promote": {
          const target = requiredText(input.idOrKey, "idOrKey");
          const status = ({ dismiss: "dismissed", resume: "active", promote: "promoted" } as const)[input.action];
          const prediction = await this.setStatus(target, status);
          return prediction
            ? result(`Prediction "${prediction.key}" is now ${status}`, prediction, [])
            : failure("PREDICTION_NOT_FOUND", `Prediction "${target}" was not found`);
        }
        default:
          return failure("VALIDATION_ERROR", `Unsupported prediction action: ${String(input.action)}`);
      }
    } catch (error) {
      return failure("PREDICTION_OPERATION_FAILED", error instanceof Error ? error.message : "Prediction operation failed");
    }
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return DOCS;
  }

  async microfrontendData() {
    const predictions = await this.listPredictions();
    return {
      channel: this.channel,
      listening: this.listening,
      outputChannel: this.outputChannel,
      predictions,
      actions: {
        refresh: () => this.microfrontendData(),
        analyze: async () => {
          await this.analyze();
          return this.microfrontendData();
        },
        ask: async (idOrKey: string) => {
          await this.ask(idOrKey, { force: true });
          return this.microfrontendData();
        },
        remove: async (idOrKey: string) => {
          await this.removePrediction(idOrKey);
          return this.microfrontendData();
        },
        dismiss: async (idOrKey: string) => {
          await this.setStatus(idOrKey, "dismissed");
          return this.microfrontendData();
        },
        resume: async (idOrKey: string) => {
          await this.setStatus(idOrKey, "active");
          return this.microfrontendData();
        },
      },
    };
  }

  async listPredictions(): Promise<Prediction[]> {
    await this.ready;
    const rows = await this.database.get<PredictionRow>(TABLE, {
      orderBy: [{ field: "createdAt", direction: "asc" }],
    });
    return rows.map(mapRow);
  }

  async addPrediction(options: AddPredictionOptions): Promise<Prediction> {
    const description = requiredText(options.description, "description");
    const key = slug(options.key ?? description);
    if (!key) throw new Error("Input 'key' is required");
    if (await this.getPrediction(key)) throw new Error(`Prediction key must be unique: "${key}"`);
    const now = this.clock();
    await this.database.add<PredictionRow>(TABLE, {
      id: `prediction-${randomUUID()}`,
      key,
      description,
      actionPrompt: requiredText(options.actionPrompt, "actionPrompt"),
      minuteOfDay: parseTime(options.time),
      weekdays: parseWeekdays(options.weekdays).join(","),
      timezone: this.timezone,
      occurrences: 0,
      status: "active",
      ignoredCount: 0,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: null,
      lastAskedAt: null,
    });
    await this.reschedule();
    return (await this.getPrediction(key))!;
  }

  async removePrediction(idOrKey: string): Promise<Prediction | undefined> {
    const prediction = await this.getPrediction(idOrKey);
    if (!prediction) return undefined;
    this.destroyTask(prediction.id);
    await this.database.delete(TABLE, prediction.id);
    return prediction;
  }

  /** Looks for one topic in the history and reports whether its timing qualifies, and why not. */
  async check(topic: string): Promise<PatternCheck> {
    const messages = await this.userMessages(new Date(this.clock().getTime() - this.lookbackDays * 86_400_000));
    if (messages.length === 0) return { messages: 0, days: 0, slotDays: 0, weekdays: [], qualifies: false, examples: [] };
    const call = await this.system2.functionCall<{ messages: number[] }>(
      checkPrompt(topic, messages),
      CHECK_FUNCTION,
    );
    const group = (call.arguments?.messages ?? []).flatMap((index) => messages[index - 1] ?? []);
    const points = group.map(({ createdAt }) => localTime(createdAt, this.timezone));
    const slot = recurringSlot(points, 1, this.windowMinutes);
    return {
      messages: group.length,
      days: new Set(points.map(({ day }) => day)).size,
      time: slot ? clockText(slot.minute) : undefined,
      slotDays: slot?.days ?? 0,
      weekdays: slot?.weekdays ?? [],
      qualifies: (slot?.days ?? 0) >= this.minDays,
      examples: group.slice(-3).map(({ text }) => text.slice(0, 120)),
    };
  }

  /** Asks the model to group recent requests by intent, then keeps the groups whose times really recur. */
  async analyze(): Promise<Prediction[]> {
    const now = this.clock();
    const messages = await this.userMessages(new Date(now.getTime() - this.lookbackDays * 86_400_000));
    if (messages.length < this.minDays) return this.listPredictions();
    const known = await this.listPredictions();
    const call = await this.system2.functionCall<PatternReport>(
      analysisPrompt(messages, known, this.timezone, this.lookbackDays),
      REPORT_FUNCTION,
    );
    for (const pattern of call.arguments?.patterns ?? []) {
      const group = pattern.messages.flatMap((index) => messages[index - 1] ?? []);
      const slot = recurringSlot(
        group.map(({ createdAt }) => localTime(createdAt, this.timezone)),
        this.minDays,
        this.windowMinutes,
      );
      if (!slot) continue;
      const lastSeen = group.reduce((latest, { createdAt }) => createdAt > latest ? createdAt : latest, group[0]!.createdAt);
      await this.upsert(pattern, slot, lastSeen, now);
    }
    await this.reschedule();
    return this.listPredictions();
  }

  /** Sends one proactive question for a prediction, at most once per local day. */
  async ask(idOrKey: string, { force = false } = {}): Promise<boolean> {
    const prediction = await this.getPrediction(idOrKey);
    const listener = this.listener;
    if (!prediction || !listener || prediction.status !== "active") return false;
    const now = this.clock();
    const today = localTime(now, this.timezone).day;
    if (!force && prediction.lastAskedAt && localTime(new Date(prediction.lastAskedAt), this.timezone).day === today) return false;

    const ignoredCount = await this.ignoredCount(prediction);
    if (ignoredCount >= MAX_IGNORED) {
      await this.database.update<PredictionRow>(TABLE, prediction.id, { status: "muted", ignoredCount, updatedAt: now });
      this.destroyTask(prediction.id);
      return false;
    }
    if (!force && await this.alreadyDone(prediction, now)) return false;

    await this.database.update<PredictionRow>(TABLE, prediction.id, { lastAskedAt: now, ignoredCount, updatedAt: now });
    await listener({
      id: `input-${randomUUID()}`,
      channel: this.channel,
      sessionId: `pattern-${prediction.id}`,
      userId: this.userId,
      text: predictionPromptText(prediction, now, this.lookbackDays),
      createdAt: now,
      metadata: {
        preferredOutputChannel: this.outputChannel,
        proactive: true,
        prediction: { id: prediction.id, key: prediction.key },
      },
    });
    return true;
  }

  private initializeDatabase(): Promise<void> {
    return this.database.init({
      tables: {
        [TABLE]: {
          primaryKey: "id",
          columns: {
            id: { type: "string", required: true },
            key: { type: "string", required: true, unique: true },
            description: { type: "string", required: true },
            actionPrompt: { type: "string", required: true },
            minuteOfDay: { type: "number", required: true },
            weekdays: { type: "string", required: true },
            timezone: { type: "string", required: true },
            occurrences: { type: "number", required: true },
            status: { type: "string", required: true },
            ignoredCount: { type: "number", required: true },
            createdAt: { type: "datetime", required: true },
            updatedAt: { type: "datetime", required: true },
            lastSeenAt: { type: "datetime" },
            lastAskedAt: { type: "datetime" },
          },
          indexes: [{ columns: ["status"] }],
        },
      },
    });
  }

  private async userMessages(since: Date): Promise<ChatMessage[]> {
    const entries = await this.memory.recall({
      userId: this.userId,
      kinds: ["working"],
      metadata: { namespace: CHAT_NAMESPACE, role: "user" },
      limit: MAX_MESSAGES,
      order: "newest",
    });
    return entries
      .filter(({ metadata }) => metadata?.proactive !== true && !PROACTIVE_CHANNELS.has(String(metadata?.channel)))
      .map(({ id, content, createdAt }) => ({
        id,
        text: (typeof content === "string" ? content : JSON.stringify(content)).replace(/\s+/g, " ").trim(),
        createdAt: new Date(createdAt),
      }))
      .filter(({ text, createdAt }) => text && createdAt >= since)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  /**
   * shortcut: any user message within 2h of the question counts as an answer,
   * upgrade to reading the reply if muting triggers on chatty nights.
   */
  private async ignoredCount(prediction: Prediction): Promise<number> {
    if (!prediction.lastAskedAt) return 0;
    const askedAt = new Date(prediction.lastAskedAt);
    const replies = await this.userMessages(askedAt);
    return replies.some(({ createdAt }) => createdAt.getTime() - askedAt.getTime() <= REPLY_WINDOW_MS)
      ? 0
      : prediction.ignoredCount + 1;
  }

  /** Skips the question when the user already asked for it in the last hours. */
  private async alreadyDone(prediction: Prediction, now: Date): Promise<boolean> {
    const recent = await this.userMessages(new Date(now.getTime() - DONE_WINDOW_MS));
    if (recent.length === 0) return false;
    const answers = await this.system2.ask(
      { habit: prediction.description, recent: recent.map(({ text }) => text) },
      {
        done: {
          type: "noul",
          instructions: "Did the user already ask for `habit` (same action, any wording) in one of the `recent` messages?",
        },
      },
    );
    return (answers.done?.noul ?? 0) >= 0.5;
  }

  private async upsert(
    pattern: PatternReport["patterns"][number],
    slot: RecurringSlot,
    lastSeen: Date,
    now: Date,
  ): Promise<void> {
    const key = slug(pattern.key);
    if (!key) return;
    const fields = {
      description: requiredText(pattern.description, "description"),
      actionPrompt: requiredText(pattern.actionPrompt, "actionPrompt"),
      minuteOfDay: slot.minute,
      weekdays: slot.weekdays.join(","),
      timezone: this.timezone,
      occurrences: slot.days,
      lastSeenAt: lastSeen,
      updatedAt: now,
    };
    const existing = await this.getPrediction(key);
    if (existing) {
      await this.database.update<PredictionRow>(TABLE, existing.id, fields);
      return;
    }
    await this.database.add<PredictionRow>(TABLE, {
      id: `prediction-${randomUUID()}`,
      key,
      ...fields,
      status: "active",
      ignoredCount: 0,
      createdAt: now,
      lastAskedAt: null,
    });
  }

  private async setStatus(idOrKey: string, status: PredictionStatus): Promise<Prediction | undefined> {
    const prediction = await this.getPrediction(idOrKey);
    if (!prediction) return undefined;
    await this.database.update<PredictionRow>(TABLE, prediction.id, {
      status,
      ...(status === "active" ? { ignoredCount: 0 } : {}),
      updatedAt: this.clock(),
    });
    await this.reschedule();
    return this.getPrediction(prediction.id);
  }

  private async getPrediction(idOrKey: string): Promise<Prediction | undefined> {
    const target = requiredText(idOrKey, "idOrKey");
    await this.ready;
    const byId = await this.database.get<PredictionRow>(TABLE, target);
    if (byId) return mapRow(byId);
    const [byKey] = await this.database.get<PredictionRow>(TABLE, { where: { key: slug(target) }, limit: 1 });
    return byKey ? mapRow(byKey) : undefined;
  }

  private async reschedule(): Promise<void> {
    if (!this.listening) return;
    for (const prediction of await this.listPredictions()) {
      this.destroyTask(prediction.id);
      if (prediction.status !== "active") continue;
      this.tasks.set(prediction.id, this.scheduler.schedule(
        askCron(prediction.minuteOfDay, prediction.weekdays, this.leadMinutes),
        () => this.ask(prediction.id).then(() => undefined, (error: unknown) =>
          console.warn(`[pattern-predictor] Prediction "${prediction.key}" failed:`, error)),
        { name: prediction.id, timezone: prediction.timezone, noOverlap: true },
      ));
    }
  }

  private destroyTask(id: string): void {
    this.tasks.get(id)?.destroy();
    this.tasks.delete(id);
  }
}

/**
 * Finds the busiest ±window slot of the day and returns it when it repeats on
 * at least `minDays` different days. Times are on a circle so 23:58 and 00:03 match.
 */
export function recurringSlot(points: readonly LocalTime[], minDays: number, windowMinutes: number): RecurringSlot | undefined {
  let best: LocalTime[] = [];
  let bestDays = 0;
  for (const center of points) {
    const near = points.filter(({ minute }) => circularDistance(minute, center.minute) <= windowMinutes);
    const days = new Set(near.map(({ day }) => day)).size;
    if (days > bestDays) [best, bestDays] = [near, days];
  }
  if (bestDays < minDays) return undefined;
  const weekdays = best.every(({ weekday }) => WORK_DAYS.includes(weekday))
    ? WORK_DAYS
    : best.every(({ weekday }) => WEEKEND.includes(weekday)) ? WEEKEND : ALL_DAYS;
  return { minute: circularMean(best.map(({ minute }) => minute)), days: bestDays, weekdays };
}

/** Cron for `lead` minutes before `minute`; crossing midnight moves the weekdays back one day. */
export function askCron(minute: number, weekdays: readonly number[], lead: number): string {
  const at = minute - lead;
  const days = at < 0 ? weekdays.map((day) => (day + 6) % 7).sort() : [...weekdays];
  const wrapped = (at + DAY_MINUTES) % DAY_MINUTES;
  return `${wrapped % 60} ${Math.floor(wrapped / 60)} * * ${days.length === 7 ? "*" : days.join(",")}`;
}

export function localTime(date: Date, timezone: string): LocalTime {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    throw new Error(`Invalid IANA timezone: "${timezone}"`);
  }
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday")),
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function circularDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % DAY_MINUTES;
  return Math.min(distance, DAY_MINUTES - distance);
}

function circularMean(minutes: readonly number[]): number {
  const angle = (minute: number) => (minute / DAY_MINUTES) * 2 * Math.PI;
  const sin = minutes.reduce((sum, minute) => sum + Math.sin(angle(minute)), 0);
  const cos = minutes.reduce((sum, minute) => sum + Math.cos(angle(minute)), 0);
  const mean = Math.round((Math.atan2(sin, cos) / (2 * Math.PI)) * DAY_MINUTES);
  return (mean + DAY_MINUTES) % DAY_MINUTES;
}

function analysisPrompt(messages: readonly ChatMessage[], known: readonly Prediction[], timezone: string, lookbackDays: number): string {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return [
    `You find habits in what a user asks their assistant. Below are the user's messages from the last ${lookbackDays} days, one per line as \`number | local time (${timezone}) | text\`.`,
    "Group messages by what the user wants, whatever the wording or language. A group is either the same concrete action (turning off the lights, asking for the weather, locking the Mac) or the same recurring activity or topic the user works on with you (brainstorming ideas for TikTok videos, planning workouts). For an activity, include every message of those conversations, follow-ups too.",
    "Only report groups that could be a recurring habit, coming back on several different days. Ignore one-offs, greetings, and bare replies like \"sì\" or \"grazie\". Timing is checked afterwards, so include every message of a group.",
    "For an activity, write `description` as the activity (\"lavorare a nuove idee per i video TikTok\") and `actionPrompt` as a useful way to start it (\"Proponi tre nuove idee per il prossimo video TikTok, tenendo conto dei video già fatti.\").",
    known.length > 0
      ? `Known habits; reuse the same key when a group is one of them:\n${known.map(({ key, description }) => `- ${key}: ${description}`).join("\n")}`
      : "There are no known habits yet.",
    "Report an empty list when nothing repeats.",
    "",
    "Messages:",
    ...messages.map(({ text, createdAt }, index) => `${index + 1} | ${format.format(createdAt)} | ${text.slice(0, 300)}`),
  ].join("\n");
}

function checkPrompt(topic: string, messages: readonly ChatMessage[]): string {
  return [
    `Find every message below in which the user asks about, or works on, this topic: "${topic}". Include follow-ups within those conversations. Lines are \`number | text\`.`,
    "",
    ...messages.map(({ text }, index) => `${index + 1} | ${text.slice(0, 300)}`),
  ].join("\n");
}

function describeCheck(topic: string, check: PatternCheck, minDays: number, lookbackDays: number): string {
  if (check.messages === 0) return `No messages about "${topic}" in the last ${lookbackDays} days.`;
  const found = `Found ${check.messages} message(s) about "${topic}" on ${check.days} different day(s) in the last ${lookbackDays} days.`;
  const slot = check.time ? ` The busiest time is around ${check.time}, on ${check.slotDays} day(s).` : "";
  const verdict = check.qualifies
    ? " That is a habit: add it with this time if the user wants the suggestion."
    : ` Not a habit yet: it needs ${minDays} different days at about the same time.`;
  return `${found}${slot}${verdict} Recent examples: ${check.examples.map((text) => `"${text}"`).join("; ")}`;
}

/** Frames the habit as a question to ask now; the action itself waits for the user's yes. */
function predictionPromptText(prediction: Prediction, now: Date, lookbackDays: number): string {
  const localTimeText = new Intl.DateTimeFormat("it-IT", {
    timeZone: prediction.timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  const usual = clockText(prediction.minuteOfDay);
  return [
    `[Habit prediction "${prediction.key}" at ${localTimeText} (${prediction.timezone})]`,
    "This is an automatic trigger, not a message from the user.",
    prediction.occurrences > 0
      ? `On ${prediction.occurrences} different days in the last ${lookbackDays} days the user asked, around ${usual}: "${prediction.description}".`
      : `The user asked to be offered this around ${usual}: "${prediction.description}".`,
    "Ask the user in one short, friendly sentence, in the same language as that request, whether they want you to do it now.",
    "Do not do it yet and do not call any tool: reply with only the question. If they say yes, the action will be:",
    prediction.actionPrompt,
  ].join("\n");
}

interface PredictionRow extends DatabaseRecord {
  id: string;
  key: string;
  description: string;
  actionPrompt: string;
  minuteOfDay: number;
  weekdays: string;
  timezone: string;
  occurrences: number;
  status: PredictionStatus;
  ignoredCount: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  lastAskedAt: Date | null;
}

function mapRow(row: PredictionRow): Prediction {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    actionPrompt: row.actionPrompt,
    minuteOfDay: Number(row.minuteOfDay),
    weekdays: String(row.weekdays).split(",").map(Number),
    timezone: row.timezone,
    occurrences: Number(row.occurrences),
    status: row.status,
    ignoredCount: Number(row.ignoredCount),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : undefined,
    lastAskedAt: row.lastAskedAt ? new Date(row.lastAskedAt).toISOString() : undefined,
  };
}

function clockText(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const minute = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Time must be HH:MM: "${value}"`);
  return minute;
}

export function parseWeekdays(value: string | undefined): number[] {
  const field = value?.trim() || "*";
  if (field === "*") return ALL_DAYS;
  const days = field.split(",").flatMap((part) => {
    const [from, to = from] = part.split("-").map((day) => Number(day.trim()) % 7);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from! > to!) throw new Error(`Invalid weekdays: "${field}"`);
    return Array.from({ length: to! - from! + 1 }, (_, index) => from! + index);
  });
  return [...new Set(days)].sort();
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function requiredText(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Input '${field}' is required`);
  return normalized;
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < 1) throw new Error(`${field} must be a positive integer`);
  return normalized;
}

function result(
  message: string,
  prediction: Prediction | null,
  predictions: Prediction[],
): CapabilityResult<ManagePredictionsOutput> {
  return { success: true, data: { message, prediction, predictions } };
}

function failure(code: string, message: string): CapabilityResult<never> {
  return { success: false, error: { code, message, retryable: false } };
}
