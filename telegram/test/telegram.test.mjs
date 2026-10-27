import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import { TelegramAdapter, TelegramOutput } from "../dist/src/index.js";

test("sends streamed output and splits long Telegram messages", async () => {
  const requests = [];
  const output = new TelegramOutput({
    botToken: "bot-token",
    chatId: "chat-123",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return jsonResponse({ ok: true });
    },
  });

  async function* content() {
    yield "x".repeat(4_096);
    yield "y";
  }

  await output.write(content());

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0]?.url,
    "https://api.telegram.org/botbot-token/sendMessage",
  );
  assert.deepEqual(
    requests.map(({ body }) => body),
    [
      { chat_id: "chat-123", text: "x".repeat(4_096) },
      { chat_id: "chat-123", text: "y" },
    ],
  );
});

test("keeps a session, maps users, and rotates the session on /new", async () => {
  const sent = [];
  const received = [];
  let updatesReturned = false;

  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    userIdMap: "456:thomas",
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      const body = JSON.parse(String(init?.body));

      if (method === "sendMessage" || method === "sendChatAction") {
        sent.push(body);
        return jsonResponse({ ok: true });
      }
      if (updatesReturned) {
        return jsonResponse({ ok: true, result: [] });
      }

      updatesReturned = true;
      return jsonResponse({
        ok: true,
        result: [
          update(1, 10, "hello"),
          update(2, 11, "/new"),
          update(3, 12, "hello again"),
        ],
      });
    },
  });

  await adapter.start(async (message) => {
    received.push({
      text: message.text,
      sessionId: message.sessionId,
      userId: message.userId,
      telegramUserId: message.metadata?.telegramUserId,
    });
    await adapter.write(`reply: ${message.text}`);
    if (received.length === 2) {
      await adapter.stop();
    }
  });

  assert.equal(received.length, 2);
  assert.notEqual(received[0]?.sessionId, received[1]?.sessionId);
  assert.deepEqual(
    received.map(({ userId, telegramUserId }) => ({
      userId,
      telegramUserId,
    })),
    [
      { userId: "thomas", telegramUserId: "456" },
      { userId: "thomas", telegramUserId: "456" },
    ],
  );
  assert.deepEqual(sent, [
    { chat_id: "123", action: "typing" },
    { chat_id: "123", text: "reply: hello" },
    { chat_id: "123", text: "Started a new conversation." },
    { chat_id: "123", action: "typing" },
    { chat_id: "123", text: "reply: hello again" },
  ]);
});

test("refreshes typing during a long request and stops after it finishes", async () => {
  const actions = [];
  let updatesReturned = false;
  let finishWork;
  let startedWork;
  const workStarted = new Promise((resolve) => { startedWork = resolve; });
  const workFinished = new Promise((resolve) => { finishWork = resolve; });

  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      if (method === "sendChatAction") {
        actions.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ok: true, result: true });
      }
      if (updatesReturned) return jsonResponse({ ok: true, result: [] });
      updatesReturned = true;
      return jsonResponse({ ok: true, result: [update(1, 10, "long task")] });
    },
  });

  const listening = adapter.start(async () => {
    startedWork();
    await workFinished;
    await adapter.stop();
  });
  await workStarted;
  assert.deepEqual(actions, [{ chat_id: "123", action: "typing" }]);
  await new Promise((resolve) => setTimeout(resolve, 4_100));
  assert.equal(actions.length, 2);
  finishWork();
  await listening;
  assert.equal(actions.length, 2);
});

test("keeps processing when Telegram rejects a typing action", async () => {
  let updatesReturned = false;
  const sent = [];
  const errors = [];
  let finishWork;
  let reportError;
  const workFinished = new Promise((resolve) => { finishWork = resolve; });
  const errorReported = new Promise((resolve) => { reportError = resolve; });
  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    onError: (error) => { errors.push(error); reportError(); },
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      if (method === "sendChatAction") {
        return new Response(JSON.stringify({ ok: false, description: "unavailable" }), { status: 503 });
      }
      if (method === "sendMessage") {
        sent.push(JSON.parse(String(init?.body)));
        return jsonResponse({ ok: true });
      }
      if (updatesReturned) return jsonResponse({ ok: true, result: [] });
      updatesReturned = true;
      return jsonResponse({ ok: true, result: [update(1, 10, "hello")] });
    },
  });

  const listening = adapter.start(async () => {
    await workFinished;
    await adapter.write("reply");
    await adapter.stop();
  });
  await errorReported;
  finishWork();
  await listening;

  assert.deepEqual(sent, [{ chat_id: "123", text: "reply" }]);
  assert.equal(errors.length, 1);
});

test("does not wait for a stalled typing request", async () => {
  let updatesReturned = false;
  let aborted = false;
  let processed = false;
  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      if (method === "sendChatAction") {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }, { once: true });
        });
      }
      if (updatesReturned) return jsonResponse({ ok: true, result: [] });
      updatesReturned = true;
      return jsonResponse({ ok: true, result: [update(1, 10, "hello")] });
    },
  });

  await adapter.start(async () => {
    processed = true;
    await adapter.stop();
  });

  assert.equal(processed, true);
  assert.equal(aborted, true);
});

test("downloads image input and removes its temporary file afterward", async () => {
  const received = [];
  let updatesReturned = false;

  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/file/botbot-token/")) {
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": "3",
          },
        });
      }

      const method = url.split("/").at(-1);
      if (method === "getFile") {
        return jsonResponse({
          ok: true,
          result: { file_path: "photos/image.jpg", file_size: 3 },
        });
      }
      if (updatesReturned) {
        return jsonResponse({ ok: true, result: [] });
      }

      void init;
      updatesReturned = true;
      return jsonResponse({
        ok: true,
        result: [photoUpdate(4, 13)],
      });
    },
  });

  await adapter.start(async (message) => {
    const attachment = message.attachments?.[0];
    assert.equal(attachment?.type, "image");
    assert.ok(attachment?.path);
    await access(attachment.path);
    received.push({
      text: message.text,
      path: attachment.path,
      mediaType: attachment.mediaType,
      hasPhoto: message.metadata?.hasPhoto,
    });
    await adapter.stop();
  });

  assert.deepEqual(received, [
    {
      text: "Describe this image.",
      path: received[0]?.path,
      mediaType: "image/jpeg",
      hasPhoto: true,
    },
  ]);
  await assert.rejects(access(received[0]?.path ?? ""));
});

test("tells the user when answering fails instead of staying silent", async () => {
  const sent = [];
  const errors = [];
  let updatesReturned = false;
  const adapter = new TelegramAdapter({
    botToken: "bot-token",
    chatId: "123",
    pollTimeoutSeconds: 0,
    onError: (error) => { errors.push(error); },
    fetch: async (input, init) => {
      const method = String(input).split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      if (method === "sendMessage") sent.push(body.text);
      if (method !== "getUpdates") return jsonResponse({ ok: true });
      if (updatesReturned) {
        await adapter.stop();
        return jsonResponse({ ok: true, result: [] });
      }
      updatesReturned = true;
      return jsonResponse({ ok: true, result: [update(1, 10, "hello")] });
    },
  });

  await adapter.start(async () => {
    throw new Error("refresh token was revoked");
  });

  assert.deepEqual(sent, ["Sorry, I could not answer that: refresh token was revoked"]);
  assert.equal(errors[0]?.message, "refresh token was revoked");
});

function update(updateId, messageId, text) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      text,
      chat: { id: 123 },
      from: { id: 456 },
    },
  };
}

function photoUpdate(updateId, messageId, caption) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: 1_700_000_000,
      caption,
      photo: [{ file_id: `photo-${messageId}`, width: 100, height: 100 }],
      chat: { id: 123 },
      from: { id: 456 },
    },
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
