import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompositeEnvironment, DotenvEnvironment, MapEnvironment, parseDotenv } from "../dist/src/index.js";

test("parses dotenv and ignores comments", () => {
  assert.deepEqual(Object.fromEntries(parseDotenv("A=one\n# no\nB='two words'\nEMPTY=\n")), { A: "one", B: "two words", EMPTY: "" });
});

test("composite environment preserves first-provider precedence", () => {
  const env = new CompositeEnvironment({ providers: [new MapEnvironment({ A: "first" }), new MapEnvironment({ A: "second", B: "value" })] });
  assert.equal(env.get("A"), "first");
  assert.equal(env.getRequired("B"), "value");
});

test("dotenv web bridge can add variables while keeping secrets masked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-os-env-node-"));
  await writeFile(join(directory, ".env"), "EXISTING=value\n", "utf8");
  const env = new DotenvEnvironment({ cwd: directory });
  const data = env.microfrontendData();
  await data.update?.({ HOME_ASSISTANT_URL: "http://homeassistant.local:8123", HOME_ASSISTANT_TOKEN: "very-secret-token" });

  assert.equal(env.get("HOME_ASSISTANT_URL"), "http://homeassistant.local:8123");
  assert.equal(env.get("HOME_ASSISTANT_TOKEN"), "very-secret-token");
  assert.equal(data.variables.find(({ key }) => key === "HOME_ASSISTANT_TOKEN"), undefined);
  const refreshed = env.microfrontendData().variables.find(({ key }) => key === "HOME_ASSISTANT_TOKEN");
  assert.equal(refreshed?.value, "");
  assert.equal(refreshed?.secret, true);
  assert.equal((await readFile(join(directory, ".env"), "utf8")).includes("very-secret-token"), true);
});

test("dotenv web bridge rejects invalid variable names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-os-env-node-"));
  const env = new DotenvEnvironment({ cwd: directory });
  await assert.rejects(
    () => env.microfrontendData().update?.({ "BAD-NAME": "value" }),
    /Invalid environment variable name/,
  );
});
