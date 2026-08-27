import type { ServerResponse } from "node:http";
import { HttpError } from "./http-error.js";

export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function writeError(response: ServerResponse, error: unknown): void {
  if (response.writableEnded) return;

  const body = errorBody(error);
  if (!response.headersSent) {
    const status = error instanceof HttpError ? error.status : 500;
    writeJson(response, status, body);
    return;
  }

  response.write(`data: ${JSON.stringify(body)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function errorBody(error: unknown) {
  const code =
    error instanceof HttpError ? error.code : "internal_server_error";
  const message =
    error instanceof Error ? error.message : "Internal server error";
  return { error: { message, type: code, code } };
}
