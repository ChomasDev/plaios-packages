import type { OpenRouterApiLogEvent } from "./types.js";

export function defaultOpenRouterApiLog(event: OpenRouterApiLogEvent): void {
  switch (event.type) {
    case "listening":
      console.log(
        `[OPENROUTER] Listening on ${event.url}/api/v1/chat/completions`,
      );
      return;
    case "request.started":
      console.log(
        `[OPENROUTER] ${event.method} ${event.path} (${event.requestId})`,
      );
      return;
    case "request.completed":
      console.log(
        `[OPENROUTER] ${event.status} ${event.method} ${event.path} ${event.durationMs}ms`,
      );
      return;
    case "request.failed":
      console.error(
        `[OPENROUTER] Failed ${event.method} ${event.path}: ${event.error}`,
      );
      return;
    case "stopped":
      console.log("[OPENROUTER] Server stopped");
  }
}

export function safeLog(
  logger: ((event: OpenRouterApiLogEvent) => void) | undefined,
  event: OpenRouterApiLogEvent,
): void {
  try {
    logger?.(event);
  } catch {
    // Logging must never fail requests or server shutdown.
  }
}
