import assert from "node:assert/strict";
import test from "node:test";

import { parseDevices, sshArguments, SshCapability, SshJevCapability } from "../dist/src/index.js";

const context = { runId: "run-1", callId: "call-1", startedAt: new Date() };
const devices = JSON.stringify([
  {
    id: "mac-studio",
    name: "Mac di Thomas",
    host: "192.168.1.230",
    user: "thomasfavero",
    os: "macos",
    privateKeyPath: "/tmp/agent-os-mac",
  },
  {
    id: "linux-box",
    name: "Villa",
    host: "192.168.1.65",
    user: "villafavero",
    os: "linux",
    privateKeyPath: "/tmp/agent-os-linux",
  },
]);

test("parses multiple devices and hides private keys from the dashboard", async () => {
  const calls = [];
  const action = new SshCapability({
    env: { get: () => undefined },
    devices,
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "ok", stderr: "", code: 0 };
    },
  });

  const data = await action.microfrontendData();
  assert.equal(data.devices.length, 2);
  assert.equal(data.devices[0].name, "Mac di Thomas");
  assert.equal(data.devices[0].hasKey, true);
  assert.equal(JSON.stringify(data).includes("/tmp/agent-os-mac"), false);

  const listed = await action.execute({ action: "list" }, context);
  assert.equal(listed.success, true);
  if (listed.success) assert.match(listed.data.summary, /Mac di Thomas/);
  assert.equal(calls.length, 0);
});

test("opens a macOS app over SSH without a shell on the server", async () => {
  const calls = [];
  const action = new SshCapability({
    env: { get: () => undefined },
    devices,
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  const result = await action.execute(
    { action: "open_app", deviceId: "mac-studio", app: "Safari" },
    context,
  );
  assert.equal(result.success, true);
  assert.equal(calls[0].device.id, "mac-studio");
  assert.match(calls[0].command, /open -a 'Safari'/);
  if (result.success) assert.match(result.data.summary, /Safari/);
});

test("builds BatchMode SSH arguments with IdentitiesOnly", () => {
  const args = sshArguments(
    {
      id: "mac",
      name: "Mac",
      host: "192.168.1.230",
      user: "thomas",
      port: 22,
      os: "macos",
    },
    "hostname",
    "/tmp/key",
  );
  assert.deepEqual(args.slice(0, 10), [
    "-F", "/dev/null",
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=8",
  ]);
  assert.equal(args.at(-2), "thomas@192.168.1.230");
  assert.equal(args.at(-1), "hostname");
});

test("Jev capability opens Safari on the named Mac", async () => {
  const calls = [];
  const action = new SshJevCapability({
    env: { get: () => undefined },
    devices,
    apiKey: "test",
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "", stderr: "", code: 0 };
    },
    typesafeFetch: async () =>
      Response.json({
        model: "jev-latest",
        answers: {
          action: { type: "choice", choice: "open_app", probabilities: { open_app: 0.9 }, confidence: 0.8 },
          "dev:mac-studio": { type: "noul", noul: 0.94 },
          "dev:linux-box": { type: "noul", noul: 0.1 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
  });

  const result = await action.execute({ text: "Apri Safari sul Mac" }, context);
  assert.equal(result.success, true);
  assert.equal(calls[0].device.id, "mac-studio");
  assert.match(calls[0].command, /Safari/);
});

test("takes a macOS screenshot with an absolute screencapture path", async () => {
  const calls = [];
  const action = new SshCapability({
    env: { get: () => undefined },
    devices,
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "/tmp/agent-os-screenshot.png", stderr: "", code: 0 };
    },
  });

  const result = await action.execute(
    { action: "screenshot", deviceId: "mac-studio" },
    context,
  );
  assert.equal(result.success, true);
  assert.match(calls[0].command, /\/usr\/sbin\/screencapture/);
});

test("copies a screenshot back to the host after capture", async () => {
  const copies = [];
  const action = new SshCapability({
    env: { get: () => undefined },
    devices,
    ssh: async () => ({ stdout: "/tmp/agent-os-screenshot.png", stderr: "", code: 0 }),
    scp: async (request) => {
      copies.push(request);
    },
  });

  const result = await action.execute(
    { action: "screenshot", deviceId: "mac-studio" },
    context,
  );
  assert.equal(result.success, true);
  assert.equal(copies[0].remotePath, "/tmp/agent-os-screenshot.png");
  assert.equal(copies[0].device.id, "mac-studio");
  if (result.success) assert.match(result.data.localPath ?? "", /agent-os-screenshot-.*\.png$/);
});

test("opens a remembered Agent OS URL on the Mac", async () => {
  const calls = [];
  const action = new SshCapability({
    env: { get: () => undefined },
    devices,
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "", stderr: "", code: 0 };
    },
  });

  const result = await action.execute(
    { action: "open_url", deviceId: "mac-studio", command: "http://100.103.217.8:3100" },
    context,
  );
  assert.equal(result.success, true);
  assert.match(calls[0].command, /open 'http:\/\/100\.103\.217\.8:3100'/);
  if (result.success) assert.match(result.data.summary, /100\.103\.217\.8:3100/);
});

test("Jev capability remembers a protocol without calling SSH", async () => {
  const stored = [];
  const action = new SshJevCapability({
    env: { get: () => undefined },
    devices,
    apiKey: "test",
    memory: {
      async upsertNode(node) {
        stored.push(node);
        return node;
      },
      async remember(entry) {
        stored.push(entry);
      },
    },
    ssh: async () => {
      throw new Error("SSH should not run while remembering a protocol");
    },
    typesafeFetch: async () => {
      throw new Error("Jev should not run while remembering a protocol");
    },
  });

  const result = await action.execute({
    text: 'ricorda che quando dico "protocollo agentos" devi aprire sul mac agentos che è al ip http://100.103.217.8:3100',
  }, context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.action, "none");
    assert.match(result.data.summary, /protocollo agentos/);
    assert.match(result.data.summary, /100\.103\.217\.8:3100/);
  }
  assert.ok(stored.some((item) => item.type === "protocol"));
});

test("Jev capability ignores a non-remote protocol", async () => {
  const action = new SshJevCapability({
    env: { get: () => undefined },
    devices,
    apiKey: "test",
    memory: {
      async listNodes() {
        return [{
          type: "protocol",
          label: "protocollo ragazza in casa",
          data: {
            trigger: "protocollo ragazza in casa",
            expansion: "imposta le luci del ufficio rosse",
          },
        }];
      },
    },
    ssh: async () => {
      throw new Error("SSH should not run for a lighting protocol");
    },
    typesafeFetch: async () => {
      throw new Error("Jev should not run for a non-remote protocol");
    },
  });

  const result = await action.execute({ text: "protocollo ragazza in casa" }, context);
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.data.action, "none");
});

test("Jev capability expands a stored protocol and opens the URL", async () => {
  const calls = [];
  const action = new SshJevCapability({
    env: { get: () => undefined },
    devices,
    apiKey: "test",
    memory: {
      async listNodes() {
        return [{
          type: "protocol",
          label: "protocollo agentos",
          data: {
            trigger: "protocollo agentos",
            expansion: "Apri http://100.103.217.8:3100 sul Mac",
            url: "http://100.103.217.8:3100",
          },
        }];
      },
    },
    ssh: async (request) => {
      calls.push(request);
      return { stdout: "", stderr: "", code: 0 };
    },
    typesafeFetch: async () => {
      throw new Error("Jev should not run for a URL protocol");
    },
  });

  const result = await action.execute({ text: "portocollo agentos" }, context);
  assert.equal(result.success, true);
  assert.equal(calls[0].device.id, "mac-studio");
  assert.match(calls[0].command, /open 'http:\/\/100\.103\.217\.8:3100'/);
});

test("reads a single device from host/user/key env fields", () => {
  const parsed = parseDevices({
    host: "192.168.1.230",
    user: "thomasfavero",
    privateKeyPath: "/tmp/key",
  });
  assert.equal(parsed[0].id, "thomasfavero-192-168-1-230");
  assert.equal(parsed[0].os, "unknown");
});
