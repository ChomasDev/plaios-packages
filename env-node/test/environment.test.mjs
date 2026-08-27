import assert from "node:assert/strict";
import test from "node:test";
import { CompositeEnvironment, MapEnvironment, parseDotenv } from "../dist/src/index.js";

test("parses dotenv and ignores comments", () => {
  assert.deepEqual(Object.fromEntries(parseDotenv("A=one\n# no\nB='two words'\nEMPTY=\n")), { A: "one", B: "two words", EMPTY: "" });
});

test("composite environment preserves first-provider precedence", () => {
  const env = new CompositeEnvironment({ providers: [new MapEnvironment({ A: "first" }), new MapEnvironment({ A: "second", B: "value" })] });
  assert.equal(env.get("A"), "first");
  assert.equal(env.getRequired("B"), "value");
});
