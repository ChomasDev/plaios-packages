import assert from "node:assert/strict";
import test from "node:test";
import { SshCapability } from "@plaios/action-ssh";

import { T3CodeCapability, T3ToolError, openCommand, resolveProject } from "../dist/src/index.js";

const context = { runId: "run-1", callId: "call-1", startedAt: new Date() };
const env = { get: () => undefined };
const projects = [
  { id: "p-voya", title: "Voya", workspaceRoot: "/Users/thomas/Project/Node/Voya", extra: true },
  { id: "p-go2", title: "go2backOffice", workspaceRoot: "/Users/thomas/Project/Node/go2Project/go2backOffice" },
  { id: "p-go2app", title: "go2App", workspaceRoot: "/Users/thomas/Project/Node/go2Project/go2App" },
];

function fakeClient(responses = {}) {
  const calls = [];
  return {
    calls,
    call: async (tool, args) => {
      calls.push({ tool, args });
      if (tool === "t3_project_list") return { projects };
      const response = responses[tool];
      if (response instanceof Error) throw response;
      return response ?? { ok: true };
    },
  };
}

test("resolves projects by title, folder, id and unique partial name", () => {
  assert.equal(resolveProject(projects, "voya").id, "p-voya");
  assert.equal(resolveProject(projects, "p-go2").id, "p-go2");
  assert.equal(resolveProject(projects, "backoffice").id, "p-go2");
  assert.throws(() => resolveProject(projects, "go2"), /matches go2backOffice/);
  assert.throws(() => resolveProject(projects, "nope"), (error) => error.code === "PROJECT_NOT_FOUND");
});

test("opens a project in the desktop app over the paired SSH Mac", async () => {
  const commands = [];
  const mac = new SshCapability({
    env,
    devices: JSON.stringify([{ id: "mac", name: "Mac", host: "100.81.121.78", user: "thomas", os: "macos", privateKeyPath: "/tmp/k" }]),
    ssh: async (request) => {
      commands.push(request.command);
      return { stdout: "T3_APP_OPENED\n", stderr: "", code: 0 };
    },
  });
  const action = new T3CodeCapability({ env, client: fakeClient(), mac });
  const result = await action.execute({ action: "open_project", project: "Voya" }, context);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.data, { id: "p-voya", title: "Voya", workspaceRoot: "/Users/thomas/Project/Node/Voya" });
  assert.match(commands[0], /env -u SSH_CONNECTION -u SSH_TTY .*t3" app '\/Users\/thomas\/Project\/Node\/Voya'/);

  const failing = new T3CodeCapability({ env, client: fakeClient(), mac: { execute: async () => ({ success: true, data: { stdout: "", stderr: "Could not reach the T3 Code desktop app.", summary: "" } }) } });
  const failed = await failing.execute({ action: "open_project", project: "voya" }, context);
  assert.equal(failed.error.code, "OPEN_FAILED");
  assert.match(failed.error.message, /desktop app/);
  assert.equal(openCommand("/a/it's"), `env -u SSH_CONNECTION -u SSH_TTY -u SSH_CLIENT "$HOME/.t3/bin/t3" app '/a/it'\\''s' && echo T3_APP_OPENED`);
});

test("launches an agent in the project or a new worktree", async () => {
  const client = fakeClient({ t3_thread_launch: { threadId: "t-1" } });
  const action = new T3CodeCapability({ env, client, mac: { execute: async () => assert.fail("no ssh") } });
  const result = await action.execute({ action: "launch_agent", project: "voya", message: "Fix login\nThen run tests", branch: "fix/login" }, context);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.data, { threadId: "t-1" });
  assert.deepEqual(client.calls[1], {
    tool: "t3_thread_launch",
    args: {
      projectId: "p-voya",
      title: "Fix login",
      message: "Fix login\nThen run tests",
      workspaceStrategy: { type: "worktree", branch: "fix/login" },
      clientRequestId: "run-1:call-1",
    },
  });
});

test("clones then registers the repo, and maps errors", async () => {
  const client = fakeClient();
  const action = new T3CodeCapability({ env, client, mac: { execute: async () => assert.fail("no ssh") } });
  await action.execute({ action: "clone_repo", repository: "chomasdev/voya", destinationPath: "/Users/thomas/Project/voya2/" }, context);
  assert.deepEqual(client.calls.map((c) => c.tool), ["t3_project_clone", "t3_project_create"]);
  assert.deepEqual(client.calls[0].args, { repository: "chomasdev/voya", destinationPath: "/Users/thomas/Project/voya2/" });
  assert.equal(client.calls[1].args.title, "voya2");

  const missing = await action.execute({ action: "send_message", threadId: "t-1", message: " " }, context);
  assert.equal(missing.error.code, "VALIDATION_ERROR");

  const refused = new T3CodeCapability({ env, client: fakeClient({ t3_thread_read: new T3ToolError("unknown thread") }), mac: {} });
  assert.deepEqual((await refused.execute({ action: "read_thread", threadId: "x" }, context)).error, { code: "T3_TOOL_ERROR", message: "unknown thread", retryable: false });

  const offline = new T3CodeCapability({ env, client: { call: async () => { throw new Error("fetch failed"); } }, mac: {} });
  const down = await offline.execute({ action: "list_projects" }, context);
  assert.equal(down.error.code, "T3_UNREACHABLE");
  assert.equal(down.error.retryable, true);
});

test("requires the MCP url and token", () => {
  assert.throws(() => new T3CodeCapability({ env }), /T3_MCP_URL/);
});

test("dashboard lists projects and reports an unreachable T3", async () => {
  const ok = await new T3CodeCapability({ env, url: "http://mac:3773/mcp", client: fakeClient(), mac: {} }).microfrontendData();
  assert.equal(ok.reachable, true);
  assert.equal(ok.url, "http://mac:3773/mcp");
  assert.deepEqual(ok.projects.map((p) => p.title), ["Voya", "go2backOffice", "go2App"]);
  const down = await new T3CodeCapability({ env, client: { call: async () => { throw new Error("offline"); } }, mac: {} }).microfrontendData();
  assert.deepEqual([down.reachable, down.projects], [false, []]);
});
