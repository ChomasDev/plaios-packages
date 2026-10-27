import assert from "node:assert/strict";
import test from "node:test";

import {
  GodsEyeViewCapability,
  buildGodsEyeViewUrl,
  inferLayer,
  inferLocation,
  inferMapStack,
} from "../dist/src/index.js";

const context = { runId: "run-1", callId: "call-1", startedAt: new Date() };
const env = { get: () => undefined };

test("builds a God's Eye View v2 camera share link", () => {
  const url = new URL(buildGodsEyeViewUrl({
    baseUrl: "http://localhost:4173",
    coordinates: { latitude: 45.6669, longitude: 12.243 },
    layer: "cameras",
  }));
  const params = new URLSearchParams(url.hash.slice(1));
  assert.equal(url.origin, "http://localhost:4173");
  assert.equal(params.get("v"), "2");
  assert.equal(params.get("lat"), "45.6669");
  assert.equal(params.get("lon"), "12.2430");
  assert.equal(params.get("l"), "c");
});

test("adds the optional Mapbox stack to share links", () => {
  const url = new URL(buildGodsEyeViewUrl({
    baseUrl: "http://localhost:4173",
    mapStack: "mapbox",
  }));
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("map"), "mapbox");
  assert.equal(inferMapStack("Use the Mapbox satellite view"), "mapbox");
});

test("infers camera layer and location from natural language", () => {
  assert.equal(inferLayer("Give me all the cameras at Treviso"), "cameras");
  assert.equal(inferLocation("Give me all the cameras at Treviso"), "Treviso");
  assert.equal(inferLayer("Mostrami i voli sopra Venezia"), "flights");
  assert.equal(inferLocation("Mostrami i voli sopra Venezia"), "Venezia");
});

test("opens the Treviso view and honestly reports upstream CCTV coverage", async () => {
  let openedUrl = "";
  const action = new GodsEyeViewCapability({
    env,
    urlOpener: async (url) => {
      openedUrl = url;
      return { opened: true, deviceId: "mac-studio" };
    },
  });
  const result = await action.execute({
    query: "Give me all the cameras at Treviso",
    location: "Treviso",
    layer: "cameras",
    deviceId: null,
  }, context);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.opened, true);
  assert.equal(result.data.deviceId, "mac-studio");
  assert.match(openedUrl, /lat=45.6669/);
  assert.match(result.data.coverageNotice, /does not currently list this area/i);
});

test("stores the occhio di dio procedural protocol", async () => {
  const nodes = [];
  const entries = [];
  const action = new GodsEyeViewCapability({
    env,
    memory: {
      async upsertNode(node) { nodes.push(node); },
      async remember(entry) { entries.push(entry); },
    },
    launchMode: "link",
  });
  const dashboard = await action.microfrontendData();
  assert.equal(dashboard.protocolReady, true);
  assert.equal(nodes[0].label, "occhio di dio");
  assert.equal(nodes[0].metadata.capabilityId, "gods-eye-view.open");
  assert.equal(entries[0].kind, "procedural");
});

test("queues native globe commands for the embedded AI bridge", async () => {
  const action = new GodsEyeViewCapability({
    env,
    launchMode: "link",
  });
  const result = await action.execute({
    query: "Show flights over Treviso in thermal style",
    location: "Treviso",
    layer: "flights",
    deviceId: null,
    openOnMac: false,
  }, context);
  assert.equal(result.success, true);
  const dashboard = await action.microfrontendData();
  const sync = await dashboard.actions.sync(0);
  assert.equal(sync.commands.length, 1);
  assert.deepEqual(sync.commands[0].commands.map((command) => command.name), [
    "fly_to_location",
    "set_layer_visibility",
    "set_visual_style",
  ]);
});
