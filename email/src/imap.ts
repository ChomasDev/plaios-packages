import { ImapFlow } from "imapflow";

/** One open mailbox: what the input needs from an IMAP connection, so tests can stand in for the server. */
export interface MailSession {
  readonly uidNext: number;
  /** Raw messages with a UID above `uid`, oldest first. */
  fetchAfter(uid: number): AsyncIterable<{ uid: number; source: Buffer }>;
  onNew(callback: () => void): void;
  onClose(callback: () => void): void;
  close(): Promise<void>;
}

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** After a long disconnection only the latest are read, so a backlog cannot flood the user. */
const MAX_BATCH = 50;

/** Opens the mailbox and keeps it open; ImapFlow idles on it, so the server pushes new mail as it arrives. */
export async function connectImap(
  account: { host: string; port: number; secure: boolean; mailbox: string },
  auth: { user: string; pass?: string; accessToken?: string },
): Promise<MailSession> {
  const client = new ImapFlow({ host: account.host, port: account.port, secure: account.secure, auth, logger: false });
  // Errors also end in "close", which the input answers by reconnecting.
  client.on("error", () => undefined);
  await client.connect();
  const opened = await client.mailboxOpen(account.mailbox);
  return {
    get uidNext() {
      const live = client.mailbox;
      return Number(live && typeof live === "object" ? live.uidNext : opened.uidNext);
    },
    async *fetchAfter(uid) {
      // Collected first: no other IMAP command may run while a fetch is open, and handling one email takes seconds.
      const messages: Array<{ uid: number; source: Buffer }> = [];
      for await (const message of client.fetch(`${uid + 1}:*`, { uid: true, source: true, size: true }, { uid: true })) {
        if (message.uid <= uid || !message.source || (message.size ?? 0) > MAX_SOURCE_BYTES) continue;
        messages.push({ uid: message.uid, source: message.source });
      }
      yield* messages.sort((left, right) => left.uid - right.uid).slice(-MAX_BATCH);
    },
    onNew(callback) { client.on("exists", callback); },
    onClose(callback) { client.on("close", callback); },
    async close() { await client.logout().catch(() => client.close()); },
  };
}
