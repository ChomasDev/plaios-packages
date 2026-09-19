import assert from "node:assert/strict";
import test from "node:test";
import { HomeAssistantCapability } from "../dist/src/index.js";

const context = { runId: "run-1", callId: "call-1", startedAt: new Date() };
const states = [
  {
    entity_id: "light.kitchen",
    state: "on",
    attributes: { friendly_name: "Kitchen", brightness: 128 },
    last_changed: "2026-08-27T20:00:00.000Z",
  },
  {
    entity_id: "sensor.temperature",
    state: "22",
    attributes: { friendly_name: "Temperature" },
    last_changed: "2026-08-27T20:00:00.000Z",
  },
  {
    entity_id: "media_player.salotto",
    state: "off",
    attributes: {
      friendly_name: "Tv Salotto",
      volume_level: 0.2,
      is_volume_muted: false,
      supported_features: 153533,
      device_class: "tv",
    },
    last_changed: "2026-08-27T20:00:00.000Z",
  },
];

function createFetch() {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json(states);
    if (url.endsWith("/api/states/light.kitchen")) return Response.json(states[0]);
    if (url.endsWith("/api/states/light.office")) {
      return Response.json({
        entity_id: "light.office",
        state: "off",
        attributes: { friendly_name: "Office" },
        last_changed: "2026-08-27T20:00:00.000Z",
      });
    }
    if (url.endsWith("/api/states/media_player.salotto")) return Response.json(states[2]);
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  return { fetch, requests };
}

test("discovers only configured controllable domains without exposing the token", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123/",
    token: "secret-token",
    entityDomains: "light,switch,fan,cover,lock,climate,scene,script,input_boolean",
    fetch: mock.fetch,
  });

  const data = await action.microfrontendData();
  assert.equal(data.connected, true);
  assert.equal(data.entities.length, 2);
  assert.equal(data.entities[0].brightness, 50);
  assert.equal(data.entities[1].entityId, "media_player.salotto");
  assert.equal(data.entities[1].volume, 20);
  assert.equal(data.entities[1].muted, false);
  assert.equal(JSON.stringify(data).includes("secret-token"), false);
  assert.equal(typeof data.actions.control, "function");
});

test("maps brightness controls to a bounded Home Assistant service call", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch: mock.fetch,
  });

  const result = await action.execute(
    { entityId: "light.kitchen", action: "set_brightness", value: 140, option: null },
    context,
  );
  assert.equal(result.success, true);
  const request = mock.requests.find(({ url }) => url.includes("/api/services/"));
  assert.equal(request.url, "http://homeassistant.local:8123/api/services/light/turn_on");
  assert.deepEqual(JSON.parse(request.init.body), { entity_id: "light.kitchen", brightness_pct: 100 });
  assert.equal(request.init.headers.authorization, "Bearer secret-token");
});

test("returns live entity states without requiring a known entity ID", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch: mock.fetch,
  });

  const result = await action.execute(
    { entityId: null, action: "get_states", value: null, option: null },
    context,
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.count, 2);
    assert.equal(result.data.entities[0].entityId, "light.kitchen");
    assert.equal(result.data.entities[0].state, "on");
    assert.equal(result.data.service, null);
  }
  assert.equal(mock.requests.some(({ url }) => url.includes("/api/services/")), false);
});

test("maps TV volume to the Home Assistant media player service", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch: mock.fetch,
  });

  const result = await action.execute(
    { entityId: "media_player.salotto", action: "set_volume", value: 20, option: null },
    context,
  );
  assert.equal(result.success, true);
  const request = mock.requests.find(({ url }) => url.includes("/api/services/"));
  assert.equal(request.url, "http://homeassistant.local:8123/api/services/media_player/volume_set");
  assert.deepEqual(JSON.parse(request.init.body), { entity_id: "media_player.salotto", volume_level: 0.2 });
});

test("rejects disabled domains and invalid domain actions", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch: mock.fetch,
  });

  const disabled = await action.execute(
    { entityId: "alarm_control_panel.home", action: "turn_off", value: null, option: null },
    context,
  );
  assert.equal(disabled.success, false);
  if (!disabled.success) assert.equal(disabled.error.code, "ENTITY_DOMAIN_NOT_ALLOWED");

  const invalid = await action.execute(
    { entityId: "switch.coffee", action: "unlock", value: null, option: null },
    context,
  );
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.equal(invalid.error.code, "ACTION_NOT_SUPPORTED");
});

test("maps named light colors to an RGB Home Assistant service call", async () => {
  const mock = createFetch();
  const action = new HomeAssistantCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch: mock.fetch,
  });

  const result = await action.execute(
    { entityId: "light.kitchen", action: "set_color", value: null, option: "verdi" },
    context,
  );
  assert.equal(result.success, true);
  const request = mock.requests.find(({ url }) => url.includes("/api/services/"));
  assert.equal(request.url, "http://homeassistant.local:8123/api/services/light/turn_on");
  assert.deepEqual(JSON.parse(request.init.body), {
    entity_id: "light.kitchen",
    rgb_color: [0, 255, 0],
  });
});

test("Jev capability turns off matching lights from natural language", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const office = {
    entity_id: "light.office",
    state: "on",
    attributes: { friendly_name: "Office" },
    last_changed: "2026-08-27T20:00:00.000Z",
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json([states[0], office, states[2]]);
    if (url.endsWith("/api/states/light.office")) return Response.json({ ...office, state: "off" });
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    apiKey: "test",
    fetch,
    typesafeFetch: async () =>
      Response.json({
        model: "jev-latest",
        answers: {
          action: {
            type: "choice",
            choice: "turn_off",
            probabilities: { turn_off: 0.9, none: 0.1 },
            confidence: 0.8,
          },
          "ent:light.kitchen": { type: "noul", noul: 0.12 },
          "ent:light.office": { type: "noul", noul: 0.97 },
          "ent:media_player.salotto": { type: "noul", noul: 0.05 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
  });

  const result = await action.execute(
    { text: "turn off all the lights in the office" },
    context,
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.action, "turn_off");
    assert.equal(result.data.entities[0].entityId, "light.office");
    assert.match(result.data.summary, /Office/);
  }
  assert.equal(
    requests.some(({ url }) => url.endsWith("/api/services/light/turn_off")),
    true,
  );
});

test("Jev capability sets office light color even if routing picks brightness", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const office = {
    entity_id: "light.office",
    state: "on",
    attributes: { friendly_name: "Luce ufficio" },
    last_changed: "2026-08-27T20:00:00.000Z",
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json([states[0], office, states[2]]);
    if (url.endsWith("/api/states/light.office")) return Response.json(office);
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    apiKey: "test",
    fetch,
    typesafeFetch: async () =>
      Response.json({
        model: "jev-latest",
        answers: {
          action: {
            type: "choice",
            choice: "set_brightness",
            probabilities: { set_brightness: 0.7, set_color: 0.2 },
            confidence: 0.6,
          },
          "ent:light.kitchen": { type: "noul", noul: 0.1 },
          "ent:light.office": { type: "noul", noul: 0.96 },
          "ent:media_player.salotto": { type: "noul", noul: 0.05 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
  });

  const result = await action.execute(
    { text: "Imposta le luci dell'ufficio verdi." },
    context,
  );
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.action, "set_color");
    assert.match(result.data.summary, /verde|Luce ufficio/);
  }
  const request = requests.find(({ url }) => url.includes("/api/services/light/turn_on"));
  assert.deepEqual(JSON.parse(request.init.body), {
    entity_id: "light.office",
    rgb_color: [0, 255, 0],
  });
});

test("Jev capability includes conversation history when matching follow-up devices", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const office = {
    entity_id: "light.office",
    state: "on",
    attributes: { friendly_name: "Luce ufficio" },
    last_changed: "2026-08-27T20:00:00.000Z",
  };
  let payload;
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    apiKey: "test",
    fetch: async (url) => {
      if (url.endsWith("/api/states")) return Response.json([states[0], office, states[2]]);
      if (url.endsWith("/api/states/light.office")) return Response.json(office);
      if (url.includes("/api/services/")) return Response.json([]);
      return new Response("Not found", { status: 404 });
    },
    typesafeFetch: async (_url, init = {}) => {
      payload = JSON.parse(init.body);
      return Response.json({
        model: "jev-latest",
        answers: {
          action: {
            type: "choice",
            choice: "set_color",
            probabilities: { set_color: 0.9 },
            confidence: 0.8,
          },
          "ent:light.kitchen": { type: "noul", noul: 0.1 },
          "ent:light.office": { type: "noul", noul: 0.95 },
          "ent:media_player.salotto": { type: "noul", noul: 0.05 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });

  const result = await action.execute(
    {
      text: "Imposta verdi",
      history: [
        { role: "user", content: "Spegni le luci in ufficio" },
        { role: "assistant", content: "Fatto, ho spento Luce ufficio." },
      ],
    },
    context,
  );
  assert.equal(result.success, true);
  assert.equal(payload.state.text, "Imposta verdi");
  assert.equal(payload.state.history[0].content, "Spegni le luci in ufficio");
  assert.match(payload.questions["ent:light.office"].instructions, /ufficio|history/);
});
