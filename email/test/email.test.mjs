import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDatabaseProvider } from "@plaios/sqlite";
import { EmailInput, SecretBox, refreshAccessToken } from "../dist/src/index.js";

const raw = (from, subject, body) => Buffer.from([`From: ${from}`, "To: thomas@example.com", `Subject: ${subject}`, "Date: Fri, 30 Oct 2026 10:00:00 +0000", "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n"));

/** An IMAP mailbox in memory: `deliver` adds a message and fires the new-mail event, like IDLE. */
function fakeServer() {
  const messages = [];
  const logins = [];
  let onNew = () => undefined;
  return {
    logins,
    deliver(source) { messages.push({ uid: 10 + messages.length + 1, source }); onNew(); },
    connect: async (account, auth) => {
      logins.push({ host: account.host, ...auth });
      if (auth.pass === "wrong") throw new Error("Authentication failed");
      return {
        uidNext: 11 + messages.length,
        async *fetchAfter(uid) { yield* messages.filter((message) => message.uid > uid); },
        onNew(callback) { onNew = callback; },
        onClose() {},
        async close() {},
      };
    },
  };
}

function setup({ system1 } = {}) {
  const server = fakeServer();
  const remembered = [];
  const notified = [];
  const input = new EmailInput({
    database: new SQLiteDatabaseProvider({ databasePath: ":memory:" }).scope("email"),
    system1: system1 ?? {
      model: "fast",
      ask: async (state) => /invoice/i.test(state.email.subject)
        ? { category: { choice: "bills" }, important: { noul: 0.92 } }
        : { category: { choice: "newsletter" }, important: { noul: 0.05 } },
    },
    memory: { remember: async (entry) => { remembered.push(entry); } },
    outputChannel: "telegram",
    userId: "thomas",
    secretsKey: "test-key",
    connect: server.connect,
  });
  void input.start(async (message) => { notified.push(message); });
  return { input, server, remembered, notified };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("sorts each new email; only the important one is remembered and sent to the agent for the chosen output", async () => {
  const { input, server, remembered, notified } = setup();
  await input.addAccount({ label: "Work", provider: "google", user: "thomas@example.com", auth: "password", password: "app-pass" });
  await settle();
  assert.equal(server.logins[0].host, "imap.gmail.com");

  server.deliver(raw("Accountant <acc@studio.it>", "Invoice 42 due Friday", "Please pay 300 EUR by Friday."));
  server.deliver(raw("News <news@shop.com>", "Weekly deals", "Discounts!"));
  await settle();

  assert.equal(notified.length, 1);
  assert.equal(notified[0].channel, "email");
  assert.equal(notified[0].metadata.preferredOutputChannel, "telegram");
  assert.equal(notified[0].metadata.proactive, true);
  assert.match(notified[0].text, /Subject: Invoice 42 due Friday[\s\S]*pay 300 EUR/);
  assert.equal(remembered.length, 1);
  assert.match(remembered[0].content, /acc@studio\.it.*Invoice 42/);

  const data = await input.microfrontendData();
  assert.deepEqual(data.emails.map(({ subject, category, important, notified: sent }) => ({ subject, category, important, notified: sent })).sort((a, b) => a.subject.localeCompare(b.subject)), [
    { subject: "Invoice 42 due Friday", category: "bills", important: true, notified: true },
    { subject: "Weekly deals", category: "newsletter", important: false, notified: false },
  ]);
  assert.equal(data.accounts[0].state, "watching");
  assert.doesNotMatch(JSON.stringify(data), /app-pass/);

  const tool = await input.execute({ importantOnly: true, category: null, query: null, limit: null });
  assert.equal(tool.success && tool.data.emails.length, 1);
  await input.stop();
});

test("refuses an account whose login fails, and old mail is never replayed", async () => {
  const { input, server, notified } = setup();
  server.deliver(raw("old@x.com", "Invoice from last year", "old"));
  await assert.rejects(input.addAccount({ label: "Bad", provider: "imap", host: "imap.x.com", user: "u", auth: "password", password: "wrong" }), /Authentication failed/);
  await input.addAccount({ label: "Ok", provider: "imap", host: "imap.x.com", user: "u", auth: "password", password: "right" });
  await settle();
  assert.equal(notified.length, 0);
  assert.equal((await input.microfrontendData()).accounts.length, 1);
  await input.stop();
});

test("without an answer from the fast model the email is still kept", async () => {
  const { input, server } = setup({ system1: { model: "fast", ask: async () => { throw new Error("model down"); } } });
  await input.addAccount({ label: "Ok", provider: "imap", host: "imap.x.com", user: "u", auth: "password", password: "right" });
  await settle();
  server.deliver(raw("a@b.c", "Hello", "hi"));
  await settle();
  const [email] = (await input.microfrontendData()).emails;
  assert.equal(email.category, "other");
  await input.stop();
});

test("seals secrets so only the same key opens them", () => {
  const box = new SecretBox("k1");
  const sealed = box.seal({ method: "password", password: "p" });
  assert.doesNotMatch(sealed, /"p"/);
  assert.deepEqual(box.open(sealed), { method: "password", password: "p" });
  assert.throws(() => new SecretBox("k2").open(sealed));
  assert.throws(() => new SecretBox(""), /SECRETS_KEY/);
});

test("refreshes an Outlook token with the IMAP scope and keeps a rotated refresh token", async () => {
  let request;
  const fetch = async (url, init) => { request = { url, body: String(init.body) }; return new Response(JSON.stringify({ access_token: "at", expires_in: 3600, refresh_token: "rt2" }), { status: 200 }); };
  const token = await refreshAccessToken("outlook", { method: "oauth2", clientId: "cid", refreshToken: "rt1" }, fetch);
  assert.equal(request.url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
  assert.match(request.body, /scope=https%3A%2F%2Foutlook\.office\.com%2FIMAP\.AccessAsUser\.All/);
  assert.equal(token.accessToken, "at");
  assert.equal(token.refreshToken, "rt2");
});
