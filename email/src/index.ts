import { randomUUID } from "node:crypto";
import type {
  Capability,
  CapabilityManifest,
  CapabilityResult,
  Database,
  DatabaseRecord,
  InputInterface,
  InputListener,
  Memory,
  System1,
} from "@plaios/core/domain";

import { connectImap, type MailSession } from "./imap.js";
import { PRESETS, refreshAccessToken, type AccountSecret, type AuthMethod, type Provider } from "./providers.js";
import { SecretBox } from "./secrets.js";
import { parseEmail, type ParsedEmail } from "./parse.js";

export { SecretBox } from "./secrets.js";
export { refreshAccessToken, PRESETS, type AccountSecret, type Provider } from "./providers.js";
export type { MailSession } from "./imap.js";

const DEFAULT_CATEGORIES = "work,personal,finance,bills,travel,shopping,newsletter,social,notifications,security,spam";
const RECONNECT_MS = [5_000, 15_000, 60_000, 300_000];

export interface EmailInputOptions {
  database: Database;
  system1?: System1;
  memory?: Memory;
  outputChannel: string;
  userId?: string;
  secretsKey: string;
  categories?: string;
  importanceRules?: string;
  threshold?: number;
  /** Tests replace the IMAP connection. */
  connect?: (account: AccountRow, auth: { user: string; pass?: string; accessToken?: string }) => Promise<MailSession>;
  fetch?: typeof fetch;
}

export interface NewAccount {
  label: string;
  provider: Provider;
  user: string;
  auth: AuthMethod;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  tenant?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  mailbox?: string;
}

interface AccountRow extends DatabaseRecord {
  id: string;
  label: string;
  provider: Provider;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  secret: string;
  enabled: boolean;
  lastUid: number | null;
  createdAt: Date;
}

interface EmailRow extends DatabaseRecord {
  id: string;
  accountId: string;
  uid: number;
  from: string;
  subject: string;
  date: Date;
  category: string;
  importance: number;
  important: boolean;
  snippet: string;
  notifiedAt: Date | null;
  receivedAt: Date;
}

export interface AccountStatus { id: string; label: string; provider: Provider; user: string; host: string; mailbox: string; enabled: boolean; state: "connecting" | "watching" | "error" | "off"; error?: string; lastCheckedAt?: string }
export interface EmailSummary { id: string; account: string; from: string; subject: string; date: string; category: string; importance: number; important: boolean; snippet: string; notified: boolean }

const IMPORTANT_RULES = [
  "Is this email important enough to interrupt the user with a notification now?",
  "Important: a real person writing to the user and expecting an answer or action, deadlines, payments due or failed, invoices and bills, bookings and travel changes, security alerts about the user's own accounts, legal, health, work requests, anything time-sensitive.",
  "Not important: newsletters, marketing and promotions, social network digests, automatic notifications that need no action, receipts for routine purchases, spam.",
];

const manifest: CapabilityManifest = {
  id: "email.inbox",
  version: "1.0.0",
  name: "read_email",
  description: "Reads the user's recent emails from every connected mailbox, already categorized and scored for importance: list the latest (optionally only important or one category) or search by sender or subject.",
  inputSchema: {
    type: "object",
    properties: {
      importantOnly: { type: ["boolean", "null"], description: "Only emails judged important." },
      category: { type: ["string", "null"], description: "Only this category, e.g. work, finance, bills." },
      query: { type: ["string", "null"], description: "Words to find in sender or subject." },
      limit: { type: ["number", "null"], description: "How many, default 20." },
    },
    required: ["importantOnly", "category", "query", "limit"],
    additionalProperties: false,
  },
  tags: ["email", "mail", "inbox", "gmail", "outlook", "posta", "messages"],
  execution: { timeoutMs: 10_000, idempotent: true },
};

/**
 * Watches every connected mailbox over IMAP IDLE. Each new email is categorized by the fast model (System 1);
 * important ones are saved to memory and handed to the agent, which notifies the user on the chosen output.
 */
export class EmailInput implements InputInterface, Capability<{ importantOnly: boolean | null; category: string | null; query: string | null; limit: number | null }, { emails: EmailSummary[] }> {
  readonly channel = "email" as const;
  readonly manifest = manifest;
  private readonly box: SecretBox;
  private readonly categories: string[];
  private readonly threshold: number;
  private readonly ready: Promise<void>;
  private readonly sessions = new Map<string, MailSession>();
  private readonly status = new Map<string, Pick<AccountStatus, "state" | "error" | "lastCheckedAt">>();
  private readonly tokens = new Map<string, { accessToken: string; expiresAt: number }>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, NodeJS.Timeout>();
  private listener?: InputListener;
  private resolveStopped?: () => void;

  constructor(private readonly options: EmailInputOptions) {
    if (!options.database) throw new Error("EmailInput requires database");
    if (!options.outputChannel?.trim()) throw new Error("EmailInput requires outputChannel");
    this.box = new SecretBox(options.secretsKey);
    this.categories = (options.categories?.trim() || DEFAULT_CATEGORIES).split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    this.threshold = Math.min(1, Math.max(0, options.threshold ?? 0.7));
    this.ready = options.database.init({
      tables: {
        accounts: {
          primaryKey: "id",
          columns: {
            id: { type: "string", required: true },
            label: { type: "string", required: true },
            provider: { type: "string", required: true },
            host: { type: "string", required: true },
            port: { type: "number", required: true },
            secure: { type: "boolean", required: true },
            user: { type: "string", required: true },
            mailbox: { type: "string", required: true },
            secret: { type: "string", required: true },
            enabled: { type: "boolean", required: true },
            lastUid: { type: "number" },
            createdAt: { type: "datetime", required: true },
          },
        },
        emails: {
          primaryKey: "id",
          columns: {
            id: { type: "string", required: true },
            accountId: { type: "string", required: true },
            uid: { type: "number", required: true },
            from: { type: "string", required: true },
            subject: { type: "string", required: true },
            date: { type: "datetime", required: true },
            category: { type: "string", required: true },
            importance: { type: "number", required: true },
            important: { type: "boolean", required: true },
            snippet: { type: "string", required: true },
            notifiedAt: { type: "datetime" },
            receivedAt: { type: "datetime", required: true },
          },
          indexes: [{ columns: ["receivedAt"] }, { columns: ["accountId"] }],
        },
      },
    });
  }

  async start(listener: InputListener): Promise<void> {
    this.listener = listener;
    const stopped = new Promise<void>((resolve) => { this.resolveStopped = resolve; });
    for (const account of await this.accounts()) if (account.enabled) void this.watch(account);
    await stopped;
  }

  async stop(): Promise<void> {
    this.listener = undefined;
    for (const timer of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    this.resolveStopped?.();
  }

  close(): Promise<void> {
    return this.stop();
  }

  uiComponents() {
    return [];
  }

  docs(): string {
    return "Emails arrive already sorted: `category` is one of the configured categories, `importance` is 0..1 and `important` is true above the threshold. Only sender, subject, date and a short excerpt are kept; the agent cannot send mail.";
  }

  async execute(input: { importantOnly: boolean | null; category: string | null; query: string | null; limit: number | null }): Promise<CapabilityResult<{ emails: EmailSummary[] }>> {
    const needle = input.query?.trim().toLowerCase();
    const emails = (await this.recent(500)).filter((email) =>
      (!input.importantOnly || email.important) &&
      (!input.category || email.category === input.category.trim().toLowerCase()) &&
      (!needle || `${email.from} ${email.subject}`.toLowerCase().includes(needle)));
    return { success: true, data: { emails: emails.slice(0, Math.max(1, Math.min(100, input.limit ?? 20))) } };
  }

  async microfrontendData() {
    const accounts = await this.accounts();
    return {
      outputChannel: this.options.outputChannel,
      categories: this.categories,
      threshold: this.threshold,
      system1: Boolean(this.options.system1),
      accounts: accounts.map((account) => this.statusOf(account)),
      emails: await this.recent(50),
      actions: {
        addAccount: async (input: NewAccount) => { await this.addAccount(input); return this.microfrontendData(); },
        removeAccount: async (id: string) => { await this.removeAccount(id); return this.microfrontendData(); },
        setEnabled: async (id: string, enabled: boolean) => { await this.setEnabled(id, enabled); return this.microfrontendData(); },
      },
    };
  }

  /** Stores the account with its secret sealed, checks it can log in, then starts watching. */
  async addAccount(input: NewAccount): Promise<AccountStatus> {
    await this.ready;
    const provider = input.provider;
    if (!["google", "outlook", "imap"].includes(provider)) throw new Error("provider must be google, outlook or imap");
    const user = required(input.user, "user");
    const preset = provider === "imap" ? undefined : PRESETS[provider];
    const host = input.host?.trim() || preset?.host;
    if (!host) throw new Error("host is required for an IMAP account");
    const secret: AccountSecret = input.auth === "oauth2"
      ? { method: "oauth2", clientId: required(input.clientId, "clientId"), refreshToken: required(input.refreshToken, "refreshToken"), ...(input.clientSecret?.trim() ? { clientSecret: input.clientSecret.trim() } : {}), ...(input.tenant?.trim() ? { tenant: input.tenant.trim() } : {}) }
      : { method: "password", password: required(input.password, "password") };
    const account: AccountRow = {
      id: `mail-${randomUUID()}`,
      label: input.label?.trim() || user,
      provider,
      host,
      port: input.port ?? preset?.port ?? 993,
      secure: input.secure ?? preset?.secure ?? true,
      user,
      mailbox: input.mailbox?.trim() || "INBOX",
      secret: this.box.seal(secret),
      enabled: true,
      lastUid: null,
      createdAt: new Date(),
    };
    // Fail before saving when the credentials do not work.
    const session = await this.open(account);
    await session.close();
    await this.options.database.add<AccountRow>("accounts", account);
    if (this.listener) void this.watch(account);
    return this.statusOf(account);
  }

  async removeAccount(id: string): Promise<void> {
    await this.ready;
    await this.unwatch(id);
    await this.options.database.delete("accounts", id);
    await this.options.database.delete("emails", { where: { accountId: id } });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.ready;
    const account = await this.options.database.update<AccountRow>("accounts", id, { enabled });
    if (!account) throw new Error(`Unknown account ${id}`);
    if (!enabled) return this.unwatch(id);
    if (this.listener) void this.watch({ ...account, enabled });
  }

  /** Categorizes one email, keeps it, and for an important one saves it to memory and wakes the agent. */
  async handleEmail(account: Pick<AccountRow, "id" | "label" | "user">, uid: number, email: ParsedEmail): Promise<EmailRow> {
    const answers = await this.options.system1?.ask(
      { email: { from: email.from, to: email.to, subject: email.subject, date: email.date.toISOString(), text: email.text.slice(0, 3_000) }, userRules: this.options.importanceRules?.trim() || null },
      {
        category: { type: "choice", instructions: "Which category fits this email best?", criteria: Object.fromEntries(this.categories.map((category) => [category, category])) },
        important: { type: "noul", instructions: [...IMPORTANT_RULES, this.options.importanceRules?.trim() ? `The user's own rules, which win: ${this.options.importanceRules.trim()}` : ""].filter(Boolean).join("\n") },
      },
    ).catch((error: unknown) => {
      console.warn(`[email] Could not classify "${email.subject}":`, error instanceof Error ? error.message : error);
      return undefined;
    });
    const category = answers?.category?.choice && this.categories.includes(answers.category.choice) ? answers.category.choice : "other";
    // Without a fast model nothing is filtered out: every email counts as worth a look.
    const importance = answers ? Number(answers.important?.noul ?? 0) : 1;
    const row: EmailRow = {
      id: `${account.id}:${uid}`,
      accountId: account.id,
      uid,
      from: email.from,
      subject: email.subject,
      date: email.date,
      category,
      importance,
      important: importance >= this.threshold,
      snippet: email.text.replace(/\s+/g, " ").trim().slice(0, 500),
      notifiedAt: null,
      receivedAt: new Date(),
    };
    await this.options.database.set<EmailRow>("emails", row.id, row);
    if (!row.important) return row;

    await this.options.memory?.remember({
      id: `email-${randomUUID()}`,
      kind: "episodic",
      content: `Email from ${email.from} to ${account.user} on ${email.date.toISOString().slice(0, 16).replace("T", " ")}: "${email.subject}". ${row.snippet}`,
      createdAt: new Date(),
      factDate: email.date,
      userId: this.options.userId,
      importance,
      metadata: { source: "email", category, account: account.label, emailId: row.id },
    }).catch((error: unknown) => console.warn("[email] Could not save to memory:", error instanceof Error ? error.message : error));

    const listener = this.listener;
    if (!listener) return row;
    await listener({
      id: `email-${randomUUID()}`,
      channel: this.channel,
      sessionId: `email-${account.id}`,
      userId: this.options.userId,
      text: notificationPrompt(account.label, email, category),
      createdAt: new Date(),
      metadata: { preferredOutputChannel: this.options.outputChannel, proactive: true, email: { id: row.id, category, importance } },
    });
    const notified = { ...row, notifiedAt: new Date() };
    await this.options.database.set<EmailRow>("emails", row.id, notified);
    return notified;
  }

  private async watch(account: AccountRow, attempt = 0): Promise<void> {
    if (!this.listener) return;
    this.status.set(account.id, { state: "connecting" });
    try {
      const session = await this.open(account);
      this.sessions.set(account.id, session);
      // A new account starts from now: old mail is not replayed as notifications.
      if (account.lastUid === null) {
        account.lastUid = session.uidNext - 1;
        await this.options.database.update<AccountRow>("accounts", account.id, { lastUid: account.lastUid });
      }
      this.status.set(account.id, { state: "watching", lastCheckedAt: new Date().toISOString() });
      session.onNew(() => this.enqueue(account, session));
      session.onClose(() => {
        if (this.sessions.get(account.id) !== session) return;
        this.sessions.delete(account.id);
        this.retry(account, 0, "Connection closed");
      });
      // Mail that arrived while disconnected.
      this.enqueue(account, session);
    } catch (error) {
      this.retry(account, attempt, error instanceof Error ? error.message : String(error));
    }
  }

  private retry(account: AccountRow, attempt: number, message: string): void {
    if (!this.listener) return;
    console.warn(`[email] ${account.label}: ${message}`);
    this.status.set(account.id, { state: "error", error: message });
    const delay = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]!;
    this.retries.set(account.id, setTimeout(() => {
      this.retries.delete(account.id);
      void this.options.database.get<AccountRow>("accounts", account.id).then((fresh) => { if (fresh?.enabled) void this.watch(fresh, attempt + 1); });
    }, delay));
  }

  private async unwatch(id: string): Promise<void> {
    clearTimeout(this.retries.get(id));
    this.retries.delete(id);
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    this.status.set(id, { state: "off" });
    await session?.close().catch(() => undefined);
  }

  /** One fetch at a time per mailbox; new-mail events during a fetch are picked up by the next one. */
  private enqueue(account: AccountRow, session: MailSession): void {
    const previous = this.queues.get(account.id) ?? Promise.resolve();
    const next = previous.then(async () => {
      for await (const message of session.fetchAfter(account.lastUid ?? 0)) {
        try {
          await this.handleEmail(account, message.uid, await parseEmail(message.source));
        } catch (error) {
          console.warn(`[email] ${account.label} uid ${message.uid}:`, error instanceof Error ? error.message : error);
        }
        account.lastUid = Math.max(account.lastUid ?? 0, message.uid);
        await this.options.database.update<AccountRow>("accounts", account.id, { lastUid: account.lastUid });
      }
      this.status.set(account.id, { state: "watching", lastCheckedAt: new Date().toISOString() });
    }).catch((error: unknown) => console.warn(`[email] ${account.label}:`, error instanceof Error ? error.message : error));
    this.queues.set(account.id, next);
  }

  private async open(account: AccountRow): Promise<MailSession> {
    const secret = this.box.open<AccountSecret>(account.secret);
    const auth = secret.method === "password"
      ? { user: account.user, pass: secret.password }
      : { user: account.user, accessToken: await this.accessToken(account, secret) };
    return (this.options.connect ?? connectImap)(account, auth);
  }

  private async accessToken(account: AccountRow, secret: Extract<AccountSecret, { method: "oauth2" }>): Promise<string> {
    const cached = this.tokens.get(account.id);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
    const token = await refreshAccessToken(account.provider, secret, this.options.fetch);
    this.tokens.set(account.id, token);
    if (token.refreshToken) {
      account.secret = this.box.seal({ ...secret, refreshToken: token.refreshToken });
      await this.options.database.update<AccountRow>("accounts", account.id, { secret: account.secret });
    }
    return token.accessToken;
  }

  private async accounts(): Promise<AccountRow[]> {
    await this.ready;
    return [...await this.options.database.get<AccountRow>("accounts", { orderBy: [{ field: "createdAt", direction: "asc" }] })];
  }

  private async recent(limit: number): Promise<EmailSummary[]> {
    await this.ready;
    const accounts = new Map((await this.accounts()).map((account) => [account.id, account.label]));
    const rows = await this.options.database.get<EmailRow>("emails", { orderBy: [{ field: "receivedAt", direction: "desc" }], limit });
    return rows.map((row) => ({
      id: row.id,
      account: accounts.get(row.accountId) ?? row.accountId,
      from: row.from,
      subject: row.subject,
      date: new Date(row.date).toISOString(),
      category: row.category,
      importance: Number(row.importance),
      important: Boolean(row.important),
      snippet: row.snippet,
      notified: Boolean(row.notifiedAt),
    }));
  }

  /** Never includes the secret. */
  private statusOf(account: AccountRow): AccountStatus {
    const live = this.status.get(account.id);
    return {
      id: account.id,
      label: account.label,
      provider: account.provider,
      user: account.user,
      host: account.host,
      mailbox: account.mailbox,
      enabled: account.enabled,
      state: account.enabled ? live?.state ?? "connecting" : "off",
      ...(live?.error ? { error: live.error } : {}),
      ...(live?.lastCheckedAt ? { lastCheckedAt: live.lastCheckedAt } : {}),
    };
  }
}

function notificationPrompt(account: string, email: ParsedEmail, category: string): string {
  return [
    `[Important email in ${account}, category ${category}]`,
    "This is an automatic trigger, not a message from the user. The email below was judged important and is already saved to memory.",
    "Write the user a short notification in their language: who wrote, what it is about, and what they may need to do (with any deadline or amount). No preamble.",
    "",
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Date: ${email.date.toISOString()}`,
    `Subject: ${email.subject}`,
    "",
    email.text.slice(0, 4_000),
  ].join("\n");
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}
