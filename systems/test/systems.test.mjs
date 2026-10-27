import assert from "node:assert/strict";
import test from "node:test";

import { askWithFunctionCall, choice, noul, noulOf } from "../dist/src/index.js";

test("System 2 answers typed questions through one function call", async () => {
  const model = {
    async functionCall(_input, definition) {
      assert.deepEqual(definition.inputSchema.properties.action.enum, ["turn_on", "turn_off"]);
      return { type: "function-call", name: definition.name, callId: "1", arguments: { action: "turn_off", "ent:light.office": 4 } };
    },
  };
  const answers = await askWithFunctionCall(model, { text: "spegni" }, {
    action: choice("Which action?", { turn_on: "On", turn_off: "Off" }),
    "ent:light.office": noul("Office light?"),
  });
  assert.equal(answers.action.choice, "turn_off");
  assert.equal(noulOf(answers, "ent:light.office"), 1);
});

test("unknown choice labels are dropped", async () => {
  const model = { functionCall: async (_i, d) => ({ type: "function-call", name: d.name, callId: "1", arguments: { action: "explode" } }) };
  const answers = await askWithFunctionCall(model, {}, { action: choice("?", { a: "A", b: "B" }) });
  assert.equal(answers.action.choice, undefined);
});
