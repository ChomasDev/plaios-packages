export interface TelegramAdapterOptions {
  botToken: string;
  chatId: string;
  fetch?: typeof globalThis.fetch;
  pollTimeoutSeconds?: number;
  maxImageBytes?: number;
  /** Maps Telegram sender IDs to stable application user IDs. */
  userIdMap?: Readonly<Record<string, string>> | string;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    caption?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id?: string;
      width?: number;
      height?: number;
      file_size?: number;
    }>;
    chat: { id: number | string };
    from?: { id: number | string };
  };
}

export interface TelegramApiResponse<T = unknown> {
  ok?: boolean;
  description?: string;
  result?: T;
}
