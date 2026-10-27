import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  InputInterface,
  InputListener,
  InputMessage,
  OutputContent,
  OutputInterface,
} from "@agent-os/core/domain";

import { TelegramApi } from "./telegram-api.js";
import type { TelegramAdapterOptions, TelegramUpdate } from "./types.js";

const MAX_MESSAGE_LENGTH = 4_096;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1_024 * 1_024;
const TYPING_INTERVAL_MS = 4_000;

/** Telegram long-polling input and correlated output adapter. */
export class TelegramAdapter implements InputInterface, OutputInterface {
  readonly channel = "telegram" as const;
  readonly instructions = "Telegram shows plain text only: no markdown, no tables, no code fences. Use short paragraphs and lines starting with a dash for lists.";
  readonly description =
    "The Telegram chat that originated this message or the configured chat";

  private readonly api: TelegramApi;
  private readonly chatId: string;
  private readonly contexts = new AsyncLocalStorage<string>();
  private readonly sessions = new Map<string, string>();
  private readonly pollTimeoutSeconds: number;
  private readonly maxImageBytes: number;
  private readonly userIdMap: ReadonlyMap<string, string>;
  private readonly onError?: TelegramAdapterOptions["onError"];
  private abort?: AbortController;
  private listening = false;
  private offset = 0;

  constructor(options: TelegramAdapterOptions) {
    const botToken = requireOption(options.botToken, "botToken");
    this.chatId = requireOption(options.chatId, "chatId");
    this.api = new TelegramApi(botToken, options.fetch ?? globalThis.fetch);
    this.pollTimeoutSeconds = Math.max(0, options.pollTimeoutSeconds ?? 25);
    this.maxImageBytes = positiveInteger(
      options.maxImageBytes,
      DEFAULT_MAX_IMAGE_BYTES,
    );
    this.userIdMap = parseUserIdMap(options.userIdMap);
    this.onError = options.onError;
  }

  async start(listener: InputListener): Promise<void> {
    if (this.listening) {
      throw new Error("Telegram listener is already running");
    }

    this.listening = true;
    this.abort = new AbortController();

    try {
      while (this.listening) {
        await this.poll(listener);
      }
    } finally {
      this.listening = false;
      this.abort = undefined;
    }
  }

  async stop(): Promise<void> {
    this.listening = false;
    this.abort?.abort();
  }

  async write(content: OutputContent): Promise<void> {
    const text =
      typeof content === "string" ? content : await collectStream(content);
    if (text.length === 0) {
      return;
    }

    const chatId = this.contexts.getStore() ?? this.chatId;
    for (const chunk of splitMessage(text)) {
      await this.api.sendMessage(chatId, chunk);
    }
  }

  private async poll(listener: InputListener): Promise<void> {
    try {
      const updates = await this.api.getUpdates(
        this.offset,
        this.pollTimeoutSeconds,
        this.abort?.signal,
      );

      for (const update of updates) {
        await this.handleUpdate(update, listener);
      }
    } catch (error) {
      if (!this.listening || this.abort?.signal.aborted) {
        return;
      }

      await this.reportError(error);
      await delay(1_000);
    }
  }

  private async handleUpdate(
    update: TelegramUpdate,
    listener: InputListener,
  ): Promise<void> {
    this.offset = Math.max(this.offset, update.update_id + 1);
    const message = update.message;
    if (!message) {
      return;
    }

    const chatId = String(message.chat.id);
    if (chatId !== this.chatId) {
      return;
    }

    const caption = message.caption?.trim();
    const photo = message.photo?.at(-1);
    const text =
      message.text?.trim() ||
      caption ||
      (photo ? "Describe this image." : "");

    if (!text) {
      return;
    }

    if (text === "/new") {
      this.sessions.set(chatId, createSessionId(chatId));
      await this.api.sendMessage(chatId, "Started a new conversation.");
      return;
    }

    const telegramUserId = message.from
      ? String(message.from.id)
      : undefined;
    let imageDirectory: string | undefined;
    let imagePath: string | undefined;
    let imageMediaType: string | undefined;

    if (photo) {
      try {
        const downloaded = await this.api.downloadFile(
          photo.file_id,
          this.maxImageBytes,
        );
        imageDirectory = await mkdtemp(join(tmpdir(), "agent-os-telegram-"));
        imageMediaType = downloaded.mediaType;
        imagePath = join(
          imageDirectory,
          `image${extensionFor(imageMediaType)}`,
        );
        await writeFile(imagePath, downloaded.bytes, { mode: 0o600 });
      } catch (error) {
        await this.reportError(error);
        await this.api.sendMessage(
          chatId,
          "I could not download that image safely. Please try a smaller JPEG or PNG.",
        );
        if (imageDirectory) {
          await rm(imageDirectory, { recursive: true, force: true });
        }
        return;
      }
    }

    const input: InputMessage = {
      id: `telegram-${message.message_id}`,
      channel: this.channel,
      sessionId: this.session(chatId),
      userId: telegramUserId
        ? this.userIdMap.get(telegramUserId) ?? telegramUserId
        : undefined,
      text,
      attachments: imagePath
        ? [{ type: "image", path: imagePath, mediaType: imageMediaType }]
        : undefined,
      createdAt: new Date(message.date * 1_000),
      metadata: {
        preferredOutputChannel: this.channel,
        chatId,
        messageId: message.message_id,
        telegramUserId,
        hasPhoto: Boolean(photo),
        telegramPhotoFileId: photo?.file_id,
      },
    };

    try {
      await this.withTyping(chatId, () =>
        this.contexts.run(chatId, () => listener(input)),
      );
    } catch (error) {
      // Without this the user only sees silence, e.g. when the model login has expired.
      await this.reportError(error);
      const reason = error instanceof Error ? error.message : String(error);
      await this.api
        .sendMessage(chatId, `Sorry, I could not answer that: ${reason.slice(0, 500)}`)
        .catch((sendError: unknown) => this.reportError(sendError));
    } finally {
      if (imageDirectory) {
        await rm(imageDirectory, { recursive: true, force: true });
      }
    }
  }

  private async withTyping(chatId: string, work: () => void | Promise<void>): Promise<void> {
    let active = true;
    let inFlight = false;
    const abort = new AbortController();
    const sendTyping = async (): Promise<void> => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        await this.api.sendTyping(chatId, abort.signal);
      } catch (error) {
        if (active) await this.reportError(error);
      } finally {
        inFlight = false;
      }
    };

    void sendTyping();
    const timer = setInterval(() => void sendTyping(), TYPING_INTERVAL_MS);
    try {
      await work();
    } finally {
      active = false;
      clearInterval(timer);
      abort.abort();
    }
  }

  private session(chatId: string): string {
    const current = this.sessions.get(chatId) ?? createSessionId(chatId);
    this.sessions.set(chatId, current);
    return current;
  }

  private async reportError(error: unknown): Promise<void> {
    if (!this.onError) {
      console.error("[telegram] Polling or message handling failed:", error);
      return;
    }

    try {
      await this.onError(error);
    } catch (callbackError) {
      console.error("[telegram] Error reporter failed:", callbackError);
      console.error("[telegram] Original error:", error);
    }
  }
}

function createSessionId(chatId: string): string {
  return `telegram-${chatId}-${randomUUID()}`;
}

function requireOption(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized) {
    return normalized;
  }
  throw new Error(`TelegramAdapter requires a non-empty ${name}`);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.trunc(value));
}

function extensionFor(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "image/gif") return ".gif";
  return ".jpg";
}

function parseUserIdMap(
  value: TelegramAdapterOptions["userIdMap"],
): ReadonlyMap<string, string> {
  if (!value) {
    return new Map();
  }

  if (typeof value !== "string") {
    return new Map(
      Object.entries(value).map(([source, target]) =>
        mappingEntry(source, target),
      ),
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    return new Map();
  }

  if (normalized.startsWith("{")) {
    const parsed: unknown = JSON.parse(normalized);
    if (!isStringRecord(parsed)) {
      throw new Error(
        "TelegramAdapter userIdMap JSON must contain string values",
      );
    }
    return parseUserIdMap(parsed);
  }

  return new Map(
    normalized.split(",").map((entry) => {
      const separator = entry.indexOf(":");
      if (separator < 1) {
        throw new Error(`Invalid Telegram userIdMap entry: ${entry}`);
      }
      return mappingEntry(
        entry.slice(0, separator),
        entry.slice(separator + 1),
      );
    }),
  );
}

function mappingEntry(source: string, target: string): [string, string] {
  const normalizedSource = requireOption(source, "userIdMap source");
  const normalizedTarget = requireOption(target, "userIdMap target");
  return [normalizedSource, normalizedTarget];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}

async function collectStream(content: AsyncIterable<string>): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of content) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

function splitMessage(text: string): string[] {
  const codePoints = [...text];
  const chunks: string[] = [];

  for (
    let offset = 0;
    offset < codePoints.length;
    offset += MAX_MESSAGE_LENGTH
  ) {
    chunks.push(
      codePoints.slice(offset, offset + MAX_MESSAGE_LENGTH).join(""),
    );
  }

  return chunks;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
