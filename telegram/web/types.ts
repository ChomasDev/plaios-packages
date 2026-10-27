interface TelegramMessageDto {
  id: string;
  sessionId: string;
  userId?: string;
  content: string;
  createdAt: string;
}

export interface TelegramInputData {
  connected?: boolean;
  lastPolledAt?: string;
  messages?: readonly TelegramMessageDto[];
}

interface TelegramDeliveryDto {
  id: string;
  chatId: string;
  preview: string;
  status: "queued" | "sent" | "failed";
  createdAt: string;
}

export interface TelegramOutputData {
  available?: boolean;
  deliveries?: readonly TelegramDeliveryDto[];
}
