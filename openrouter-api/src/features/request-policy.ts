import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./http-error.js";
import type { ResolvedOpenRouterApiOptions } from "./types.js";
import { firstHeader } from "./utils.js";

export function authorize(
  request: IncomingMessage,
  apiKey?: string,
): void {
  if (!apiKey) return;
  if (firstHeader(request, "authorization") === `Bearer ${apiKey}`) return;
  throw new HttpError(
    401,
    "Invalid or missing bearer token",
    "invalid_api_key",
  );
}

export function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  configured: ResolvedOpenRouterApiOptions["corsOrigins"] = "*",
): void {
  if (configured === false) return;

  const origin = firstHeader(request, "origin");
  if (configured !== "*" && origin && !configured.includes(origin)) {
    throw new HttpError(403, "Origin is not allowed", "cors_error");
  }

  response.setHeader(
    "access-control-allow-origin",
    allowedOrigin(configured, origin),
  );
  response.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, x-session-id, x-openclaw-agent-id, x-openclaw-message-channel, x-openclaw-model, x-openclaw-session-key, x-openclaw-scopes",
  );
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-expose-headers", "x-request-id");
  response.setHeader("vary", "Origin");
}

function allowedOrigin(
  configured: "*" | readonly string[],
  origin?: string,
): string {
  if (configured === "*") return "*";
  return origin ?? configured[0] ?? "";
}
