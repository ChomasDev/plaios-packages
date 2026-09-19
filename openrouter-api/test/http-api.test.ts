import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { InputListener, InputMessage } from "@agent-os/core/domain";
import { WebSocket } from "ws";
import { OpenRouterApiInput } from "../src/index.js";

test("serves health and advertised models", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    models: [{ id: "agent-os", name: "Agent OS", contextLength: 128_000 }],
  });

  await withServer(api, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      service: "agent-os-openrouter-api",
    });

    const response = await fetch(`${baseUrl}/v1/models`);
    const body = (await response.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(response.status, 200);
    assert.equal(body.data[0]?.id, "agent-os");
    assert.equal(body.data[0]?.context_length, 128_000);
  });
});

test("correlates a chat request with its JSON response", async () => {
  let received: InputMessage | undefined;
  const api = new OpenRouterApiInput({ port: 0, log: false });
  const listener: InputListener = async (message) => {
    received = message;
    await api.write("Hello from Agent OS");
  };

  await withServer(api, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": "header-session" },
      body: JSON.stringify({
        model: "agent-os",
        session_id: "web-1",
        user: "user-1",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    const body = (await response.json()) as {
      id: string;
      choices: Array<{ message: { content: string } }>;
    };

    assert.equal(response.status, 200);
    assert.match(body.id, /^chatcmpl-/);
    assert.equal(body.choices[0]?.message.content, "Hello from Agent OS");
    assert.equal(received?.sessionId, "web-1");
    assert.equal(received?.userId, "user-1");
    assert.match(received?.text ?? "", /USER:\nHello/);
    assert.equal(received?.metadata?.originalText, "Hello");
  }, listener);
});

test("uses a configured stable user when the client omits user", async () => {
  let received: InputMessage | undefined;
  const api = new OpenRouterApiInput({ port: 0, log: false, userId: "owner" });
  const listener: InputListener = async (message) => {
    received = message;
    await api.write("ok");
  };

  await withServer(api, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-os",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(received?.userId, "owner");
  }, listener);
});

test("streams responses and rejects invalid bearer tokens", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    apiKey: "secret",
  });
  const listener: InputListener = async () => {
    await api.write(toStream(["A streaming response"]));
  };

  await withServer(api, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "agent-os",
        stream: true,
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.match(body, /A streaming response/);
    assert.match(body, /data: \[DONE\]/);
  }, listener);
});

test("serves OpenClaw model aliases and OpenResponses completions", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    openClawCompatibility: true,
    models: ["openclaw", "openclaw/default", "openclaw/main"],
  });
  const listener: InputListener = async () => {
    await api.write("Hello from Responses");
  };

  await withServer(api, async (baseUrl) => {
    const model = await fetch(`${baseUrl}/v1/models/openclaw%2Fmain`);
    assert.equal(model.status, 200);
    assert.deepEqual(await model.json(), {
      id: "openclaw/main",
      object: "model",
      created: 0,
      owned_by: "openclaw",
      permission: [],
    });

    const response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openclaw/default",
        input: "Hello",
        user: "responses-user",
      }),
    });
    const body = (await response.json()) as {
      object: string;
      status: string;
      output: Array<{ content: Array<{ text: string }> }>;
    };
    assert.equal(response.status, 200);
    assert.equal(body.object, "response");
    assert.equal(body.status, "completed");
    assert.equal(body.output[0]?.content[0]?.text, "Hello from Responses");
  }, listener);
});

test("supports the OpenClaw WebSocket chat handshake, send, and history", async () => {
  const api = new OpenRouterApiInput({
    port: 0,
    log: false,
    apiKey: "secret",
    openClawCompatibility: true,
    models: ["openclaw", "openclaw/default", "openclaw/main"],
  });
  const listener: InputListener = async () => {
    await api.write(toStream(["Hello ", "over WS"]));
  };

  await withServer(api, async (baseUrl) => {
    const socket = new WebSocket(baseUrl.replace("http://", "ws://"));
    const challengePromise = onceFrame(
      socket,
      (frame) => frame.event === "connect.challenge",
    );
    await onceSocketOpen(socket);
    const challenge = await challengePromise;
    assert.equal(typeof (challenge.payload as { nonce?: unknown })?.nonce, "string");

    const connectedPromise = onceFrame(socket, (frame) => frame.id === "connect-1");
    socket.send(JSON.stringify({
      type: "req",
      id: "connect-1",
      method: "connect",
      params: {
        minProtocol: 4,
        maxProtocol: 4,
        client: { id: "test", version: "1", platform: "test", mode: "test" },
        auth: { token: "secret" },
      },
    }));
    const connected = await connectedPromise;
    assert.equal(connected.ok, true);
    assert.equal((connected.payload as { type?: string })?.type, "hello-ok");

    const startedPromise = onceFrame(socket, (frame) => frame.id === "send-1");
    const finalPromise = onceFrame(socket, (frame) =>
      frame.event === "chat" &&
      (frame.payload as { state?: string })?.state === "final");
    socket.send(JSON.stringify({
      type: "req",
      id: "send-1",
      method: "chat.send",
      params: {
        sessionKey: "agent:main:test",
        message: "Hello",
        idempotencyKey: "run-1",
      },
    }));
    const started = await startedPromise;
    assert.deepEqual(started.payload, { runId: "run-1", status: "started" });
    const final = await finalPromise;
    const finalPayload = final.payload as {
      message?: { content?: Array<{ text?: string }> };
    };
    assert.equal(finalPayload.message?.content?.[0]?.text, "Hello over WS");

    const historyPromise = onceFrame(socket, (frame) => frame.id === "history-1");
    socket.send(JSON.stringify({
      type: "req",
      id: "history-1",
      method: "chat.history",
      params: { sessionKey: "agent:main:test" },
    }));
    const history = await historyPromise;
    assert.equal((history.payload as { messages?: unknown[] })?.messages?.length, 2);
    socket.close();
  }, listener);
});

test("keeps chat history on a stable user session when the client sends only the latest turn", async () => {
  const received: InputMessage[] = [];
  const api = new OpenRouterApiInput({ port: 0, log: false, userId: "thomas" });
  const listener: InputListener = async (message) => {
    received.push(message);
    await api.write(received.length === 1 ? "Ho spento le luci in ufficio." : "Le metto verdi.");
  };

  await withServer(api, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-os",
        messages: [{ role: "user", content: "Spegni le luci in ufficio" }],
      }),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-os",
        messages: [{ role: "user", content: "Imposta verdi" }],
      }),
    });
    assert.equal(second.status, 200);
    assert.equal(received[0]?.sessionId, "openrouter-thomas");
    assert.equal(received[1]?.sessionId, "openrouter-thomas");
    assert.equal(received[1]?.metadata?.originalText, "Imposta verdi");
    assert.match(received[1]?.text ?? "", /Spegni le luci in ufficio/);
    assert.deepEqual(received[1]?.metadata?.conversationHistory, [
      { role: "user", content: "Spegni le luci in ufficio" },
      { role: "assistant", content: "Ho spento le luci in ufficio." },
    ]);
  }, listener);
});

test("expands an OpenClaw transcript into the last user turn plus recent history", async () => {
  let received: InputMessage | undefined;
  const api = new OpenRouterApiInput({ port: 0, log: false, userId: "thomas" });
  const listener: InputListener = async (message) => {
    received = message;
    await api.write("Ho impostato le luci sul blu.");
  };

  await withServer(api, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "agent-os",
        messages: [{
          role: "user",
          content: [
            "Conversation supplied through an OpenRouter-compatible API:",
            "",
            "USER:",
            "Accendi tutte le luci in ufficio.",
            "",
            "ASSISTANT:",
            "Fatto, ho acceso led ufficio e Luce ufficio.",
            "",
            "USER:",
            "Le metti verdi.",
            "",
            "ASSISTANT:",
            "Fatto, ho impostato le luci dell’ufficio sul verde.",
            "",
            "USER:",
            "Le metti blu.",
          ].join("\n"),
        }],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(received?.metadata?.originalText, "Le metti blu.");
    assert.deepEqual(received?.metadata?.conversationHistory, [
      { role: "user", content: "Accendi tutte le luci in ufficio." },
      { role: "assistant", content: "Fatto, ho acceso led ufficio e Luce ufficio." },
      { role: "user", content: "Le metti verdi." },
      { role: "assistant", content: "Fatto, ho impostato le luci dell’ufficio sul verde." },
    ]);
  }, listener);
});

async function withServer(
  api: OpenRouterApiInput,
  task: (baseUrl: string) => Promise<void>,
  listener: InputListener = () => undefined,
): Promise<void> {
  const running = api.start(listener);
  try {
    const address = await waitForAddress(api);
    await task(`http://127.0.0.1:${address.port}`);
  } finally {
    await api.stop();
    await running;
  }
}

async function waitForAddress(api: OpenRouterApiInput): Promise<AddressInfo> {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const address = api.address;
    if (typeof address === "object" && address) return address;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("OpenRouter API did not start listening");
}

async function* toStream(chunks: readonly string[]): AsyncGenerator<string> {
  yield* chunks;
}

type SocketFrame = Record<string, unknown>;

function onceSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) return resolve();
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function onceFrame(
  socket: WebSocket,
  predicate: (frame: SocketFrame) => boolean,
): Promise<SocketFrame> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket frame"));
    }, 3_000);
    const onMessage = (raw: WebSocket.RawData) => {
      const frame = JSON.parse(raw.toString()) as SocketFrame;
      if (!predicate(frame)) return;
      cleanup();
      resolve(frame);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}
