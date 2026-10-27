import assert from "node:assert/strict";
import test from "node:test";

import { JevSystem1 } from "../dist/src/index.js";

test("asks Jev with the configured model", async () => {
  let body;
  const system1 = new JevSystem1({
    apiKey: "k",
    model: "jev-fast",
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ model: "jev-fast", usage: { input_tokens: 1, output_tokens: 1 }, answers: { on: { type: "noul", noul: 0.9 } } });
    },
  });
  const answers = await system1.ask({ text: "accendi" }, { on: { type: "noul", instructions: "On?" } });
  assert.equal(system1.model, "jev-fast");
  assert.equal(body.model, "jev-fast");
  assert.equal(answers.on.noul, 0.9);
});
