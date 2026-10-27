import type { ChatCompletionMessage } from "./types.js";
import { parseTranscriptTurns, renderContent } from "./conversation.js";

const STORED_MESSAGE_LIMIT = 40;
const HISTORY_LIMIT = 10;

export class ConversationStore {
  private readonly sessions = new Map<string, ChatCompletionMessage[]>();

  resolve(
    sessionId: string,
    incoming: readonly ChatCompletionMessage[],
  ): ChatCompletionMessage[] {
    const normalized = expandTranscriptMessages(incoming);
    const stored = this.sessions.get(sessionId) ?? [];
    if (stored.length === 0 || incomingIncludesHistory(stored, normalized)) {
      return normalized;
    }
    return [...stored, ...normalized];
  }

  remember(
    sessionId: string,
    messages: readonly ChatCompletionMessage[],
    assistantText: string,
  ): void {
    const next = [
      ...messages,
      { role: "assistant" as const, content: assistantText },
    ].slice(-STORED_MESSAGE_LIMIT);
    this.sessions.set(sessionId, next);
  }
}

export function compactHistory(
  messages: readonly ChatCompletionMessage[],
): Array<{ role: string; content: string }> {
  return messages
    .flatMap((message) => {
      const content = renderContent(message.content).trim();
      if (!content) return [];
      return [{ role: message.role, content }];
    })
    .slice(-HISTORY_LIMIT);
}

function expandTranscriptMessages(
  messages: readonly ChatCompletionMessage[],
): ChatCompletionMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [message];
    const turns = parseTranscriptTurns(renderContent(message.content));
    if (turns.length <= 1) return [message];
    return turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
  });
}

function incomingIncludesHistory(
  stored: readonly ChatCompletionMessage[],
  incoming: readonly ChatCompletionMessage[],
): boolean {
  if (incoming.length >= stored.length + 1) return true;
  const firstUser = stored.find((message) => message.role === "user");
  if (!firstUser) return incoming.length >= stored.length;
  const firstText = renderContent(firstUser.content).trim();
  return incoming.some(
    (message) => message.role === "user" && renderContent(message.content).trim() === firstText,
  );
}
