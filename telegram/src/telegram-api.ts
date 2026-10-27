import type {
  TelegramApiResponse,
  TelegramUpdate,
} from "./types.js";

export class TelegramApi {
  constructor(
    private readonly botToken: string,
    private readonly fetch: typeof globalThis.fetch,
  ) {}

  async getUpdates(
    offset: number,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<readonly TelegramUpdate[]> {
    const result = await this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset, timeout, allowed_updates: ["message"] },
      signal,
    );
    return result ?? [];
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  async sendTyping(chatId: string, signal?: AbortSignal): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }, signal);
  }

  async downloadFile(
    fileId: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const file = await this.call<{ file_path?: string; file_size?: number }>(
      "getFile",
      { file_id: fileId },
    );

    if (!file?.file_path) {
      throw new Error("Telegram getFile did not return a file path");
    }
    if (file.file_size !== undefined && file.file_size > maxBytes) {
      throw new Error(`Telegram image exceeds the ${maxBytes}-byte limit`);
    }

    const response = await this.fetch(
      `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`,
    );
    if (!response.ok) {
      throw new Error(
        `Telegram file download failed (${response.status}): ${response.statusText}`,
      );
    }

    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(`Telegram image exceeds the ${maxBytes}-byte limit`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Telegram image exceeds the ${maxBytes}-byte limit`);
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim();

    return {
      bytes,
      mediaType: contentType?.startsWith("image/")
        ? contentType
        : "image/jpeg",
    };
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    const response = await this.fetch(
      `https://api.telegram.org/bot${this.botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    const result = (await response.json()) as TelegramApiResponse<T>;

    if (response.ok && result.ok === true) {
      return result.result;
    }

    throw new Error(
      `Telegram ${method} failed (${response.status}): ${
        result.description ?? response.statusText
      }`,
    );
  }
}
