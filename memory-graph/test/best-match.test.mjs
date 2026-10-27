import assert from "node:assert/strict";
import test from "node:test";
import { bestMatch, neighborhood } from "../dist/src/graph-focus.js";

test("centers on the entity node, not on a transcript that mentions the name", () => {
  const nodes = [
    { id: "m1", type: "memory", label: "USER: chi è Valentina Brisolin?\nASSISTANT: ...", weight: 1 },
    { id: "m2", type: "memory", label: "Di Valentina so poco", weight: 1.4 },
    { id: "p1", type: "people", label: "Valentina", weight: 1.2 },
    { id: "p2", type: "people", label: "Valentina Brisolin", weight: 0.9 },
  ];
  assert.equal(bestMatch(nodes, "valentina brisolin")?.id, "p2");
  assert.equal(bestMatch(nodes, "Valentina")?.id, "p1");
  assert.equal(bestMatch(nodes, "nobody"), undefined);
});

test("collects the neighbourhood within the requested hops", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, type: "memory", label: id, weight: 1 }));
  const edges = [{ id: "ab", sourceId: "a", targetId: "b", type: "x", weight: 1 }, { id: "bc", sourceId: "b", targetId: "c", type: "x", weight: 1 }, { id: "cd", sourceId: "c", targetId: "d", type: "x", weight: 1 }];
  assert.deepEqual(neighborhood(nodes, edges, "a", 1).nodes.map((n) => n.id), ["a", "b"]);
  assert.deepEqual(neighborhood(nodes, edges, "a", 2).nodes.map((n) => n.id), ["a", "b", "c"]);
  assert.equal(neighborhood(nodes, edges, "a", 2).edges.length, 2);
});
