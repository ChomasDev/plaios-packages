import readline from "node:readline";

let nextThread = 1;
let nextTurn = 1;

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "initialized") continue;
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "test" } });
    continue;
  }
  if (message.method === "thread/start") {
    const id = `thread-${nextThread++}`;
    send({ id: message.id, result: { thread: { id } } });
    continue;
  }
  if (message.method === "turn/start") {
    const id = `turn-${nextTurn}`;
    const text = `process-turn-${nextTurn++}`;
    send({ id: message.id, result: { turn: { id, status: "inProgress", items: [] } } });
    send({ method: "item/completed", params: { threadId: message.params.threadId, turnId: id, item: { type: "agentMessage", id: `item-${id}`, text } } });
    send({ method: "turn/completed", params: { threadId: message.params.threadId, turn: { id, status: "completed", items: [] } } });
    continue;
  }
  if (message.id !== undefined) send({ id: message.id, result: {} });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
