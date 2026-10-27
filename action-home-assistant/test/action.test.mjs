import assert from "node:assert/strict";
import test from "node:test";
import { JevSystem1 } from "@plaios/system1-jev";
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
    fetch,
    system1: new JevSystem1({ apiKey: "test", fetch: async () =>
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
      }) }),
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
    fetch,
    system1: new JevSystem1({ apiKey: "test", fetch: async () =>
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
      }) }),
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
    fetch: async (url) => {
      if (url.endsWith("/api/states")) return Response.json([states[0], office, states[2]]);
      if (url.endsWith("/api/states/light.office")) return Response.json(office);
      if (url.includes("/api/services/")) return Response.json([]);
      return new Response("Not found", { status: 404 });
    },
    system1: new JevSystem1({ apiKey: "test", fetch: async (_url, init = {}) => {
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
    } }),
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

test("Jev capability runs a script without reporting the matched TV as a failure", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const script = {
    entity_id: "script.telecamere_su_tv",
    state: "off",
    attributes: { friendly_name: "Telecamere su TV" },
    last_changed: "2026-08-27T20:00:00.000Z",
  };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json([states[0], script, states[2]]);
    if (url.endsWith("/api/states/script.telecamere_su_tv")) return Response.json({ ...script, state: "on" });
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch,
    system1: new JevSystem1({ apiKey: "test", fetch: async () =>
      Response.json({
        model: "jev-latest",
        answers: {
          action: { type: "choice", choice: "activate", probabilities: { activate: 0.9 }, confidence: 0.8 },
          "ent:light.kitchen": { type: "noul", noul: 0.02 },
          "ent:script.telecamere_su_tv": { type: "noul", noul: 0.95 },
          "ent:media_player.salotto": { type: "noul", noul: 0.8 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }) }),
  });

  const result = await action.execute({ text: "apri telecamere sulla tv" }, context);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.action, "activate");
    assert.deepEqual(result.data.entities.map((entity) => entity.entityId), ["script.telecamere_su_tv"]);
    assert.equal(result.data.summary, "Ho attivato Telecamere su TV.");
  }
  const services = requests.filter(({ url }) => url.includes("/api/services/")).map(({ url }) => url);
  assert.deepEqual(services, ["http://homeassistant.local:8123/api/services/script/turn_on"]);
});

test("Jev capability activates only the best matching script", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const script = (id, name) => ({
    entity_id: `script.${id}`,
    state: "off",
    attributes: { friendly_name: name },
    last_changed: "2026-08-27T20:00:00.000Z",
  });
  const perimetro = script("protocollo_perimetro", "Protocollo perimetro");
  const totale = script("protocollo_totale", "Protocollo totale");
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json([perimetro, totale]);
    if (url.endsWith("/api/states/script.protocollo_totale")) return Response.json(totale);
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch,
    system1: new JevSystem1({ apiKey: "test", fetch: async () =>
      Response.json({
        model: "jev-latest",
        answers: {
          action: { type: "choice", choice: "activate", probabilities: { activate: 0.9 }, confidence: 0.8 },
          "ent:script.protocollo_perimetro": { type: "noul", noul: 0.6 },
          "ent:script.protocollo_totale": { type: "noul", noul: 0.9 },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }) }),
  });

  const result = await action.execute({ text: "accendi l'antifurto" }, context);
  assert.equal(result.success, true);
  const services = requests.filter(({ url }) => url.includes("/api/services/"));
  assert.equal(services.length, 1);
  assert.deepEqual(JSON.parse(services[0].init.body), { entity_id: "script.protocollo_totale" });
});

test("splits compound commands only before a new verb", async () => {
  const { splitCommands } = await import("../dist/src/jev.js");
  assert.deepEqual(splitCommands("apri il cancello e spegni la tv"), ["apri il cancello", "spegni la tv"]);
  assert.deepEqual(splitCommands("spegni la tv, poi accendi l'antifurto"), ["spegni la tv", "accendi l'antifurto"]);
  assert.deepEqual(splitCommands("accendi la luce e il led dell'ufficio"), ["accendi la luce e il led dell'ufficio"]);
  assert.deepEqual(splitCommands("turn off the lights"), ["turn off the lights"]);
});

test("Jev capability runs each command of a compound request in order", async () => {
  const { HomeAssistantJevCapability } = await import("../dist/src/index.js");
  const gate = {
    entity_id: "script.apri_cancello",
    state: "off",
    attributes: { friendly_name: "Apri cancello" },
    last_changed: "2026-08-27T20:00:00.000Z",
  };
  const tvOn = { ...states[2], state: "on" };
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/api/states")) return Response.json([gate, tvOn]);
    if (url.endsWith("/api/states/script.apri_cancello")) return Response.json(gate);
    if (url.endsWith("/api/states/media_player.salotto")) return Response.json(states[2]);
    if (url.includes("/api/services/")) return Response.json([]);
    return new Response("Not found", { status: 404 });
  };
  const answersFor = (text) =>
    text.includes("cancello")
      ? { action: "activate", "ent:script.apri_cancello": 0.95, "ent:media_player.salotto": 0.05 }
      : { action: "turn_off", "ent:script.apri_cancello": 0.02, "ent:media_player.salotto": 0.95 };
  const action = new HomeAssistantJevCapability({
    env: { get: () => undefined },
    baseUrl: "http://homeassistant.local:8123",
    token: "secret-token",
    fetch,
    system1: new JevSystem1({ apiKey: "test", fetch: async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      const splitKeys = Object.keys(body.questions).filter((key) => key.startsWith("split:"));
      if (splitKeys.length > 0) {
        // Splitter pass: a new command starts at "spegni" (word 3 or 4 depending on the "e")
        const words = body.state.text.split(/\s+/);
        return Response.json({
          model: "jev-latest",
          answers: {
            count: { type: "choice", choice: "2", probabilities: { 2: 0.9 }, confidence: 0.8 },
            ...Object.fromEntries(
              // Real Jev also says "yes" to some wrong gaps; only the best one is used
              splitKeys.map((key) => [key, { type: "noul", noul: words[Number(key.slice(6))] === "spegni" ? 0.93 : 0.6 }]),
            ),
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      const { action: choice, ...scores } = answersFor(body.state.text);
      return Response.json({
        model: "jev-latest",
        answers: {
          action: { type: "choice", choice, probabilities: { [choice]: 0.9 }, confidence: 0.8 },
          ...Object.fromEntries(Object.entries(scores).map(([key, noul]) => [key, { type: "noul", noul }])),
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    } }),
  });

  for (const text of ["apri il cancello e spegni la tv", "apri il cancello spegni la tv"]) {
    requests.length = 0;
    const result = await action.execute({ text }, context);
    assert.equal(result.success, true);
    const services = requests.filter(({ url }) => url.includes("/api/services/")).map(({ url }) => url.split("/api/services/")[1]);
    assert.deepEqual(services, ["script/turn_on", "media_player/turn_off"], text);
    if (result.success) {
      assert.match(result.data.summary, /Apri cancello/);
      assert.match(result.data.summary, /Tv Salotto/);
    }
  }
});

test("serves camera snapshots as data URLs and tags entities with their area", async () => {
  const cameraStates = [
    { entity_id: "camera.ingresso_garage", state: "idle", attributes: { friendly_name: "Ingresso Garage", access_token: "rotating" }, last_changed: "2026-08-27T20:00:00.000Z" },
    { entity_id: "camera.lato_casa", state: "idle", attributes: { friendly_name: "Lato Casa" }, last_changed: "2026-08-27T20:00:00.000Z" },
    { entity_id: "sensor.temperatura_garage", state: "18.46", attributes: { friendly_name: "Temperatura", unit_of_measurement: "°C" }, last_changed: "2026-08-27T20:00:00.000Z" },
  ];
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push(url);
    if (url.endsWith("/api/states")) return Response.json(cameraStates);
    if (url.endsWith("/api/template")) return new Response(JSON.stringify([["sensor.temperatura_garage", "Garage"]]));
    if (url.includes("/api/camera_proxy/camera.ingresso_garage")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    return new Response("Not found", { status: 404 });
  };
  const action = new HomeAssistantCapability({ env: { get: () => undefined }, baseUrl: "http://ha.local:8123", token: "secret-token", entityDomains: "camera,sensor", fetch });

  const data = await action.microfrontendData();
  assert.equal(data.entities.find((entity) => entity.entityId === "sensor.temperatura_garage").area, "Garage");
  assert.equal(data.openui, undefined);
  assert.deepEqual(action.uiComponents().map((spec) => spec.name), ["HomeCameras", "HomeDevices"]);

  const snapshot = await data.queries.snapshot("camera.ingresso_garage");
  assert.equal(snapshot.image, "data:image/jpeg;base64,AQID");
  assert.match(requests.at(-1), /\/api\/camera_proxy\/camera\.ingresso_garage\?width=640$/);
  await assert.rejects(data.queries.snapshot("light.kitchen"), /camera entity id/);

  const all = await action.execute({ entityId: null, action: "get_states", value: null, option: null }, context);
  assert.deepEqual(all.data.entities.map((entity) => entity.entityId), ["camera.ingresso_garage", "camera.lato_casa"]);
  const garage = await action.execute({ entityId: null, action: "get_states", value: null, option: "garage" }, context);
  assert.deepEqual(garage.data.entities.map((entity) => entity.entityId).sort(), ["camera.ingresso_garage", "sensor.temperatura_garage"]);
});

test("on the web chat a Jev answer carries live device tiles in OpenUI Lang", async () => {
  const { withDeviceCard } = await import("../dist/src/index.js");
  const entity = { entityId: "light.salotto", domain: "light", name: "Salotto", state: "on", available: true, lastChanged: "" };
  const result = withDeviceCard({ success: true, data: { action: "get_states", entities: [entity, entity], count: 2, summary: "La luce \"Salotto\" è accesa.", service: null } });
  assert.equal(result.data.summary, 'root = Stack([message, devices])\nmessage = TextContent("La luce \\"Salotto\\" è accesa.")\ndevices = HomeDevices("", ["light.salotto"])');
  const empty = { success: true, data: { action: "none", entities: [], count: 0, summary: "Nothing.", service: null } };
  assert.equal(withDeviceCard(empty), empty);
  const long = withDeviceCard({ success: true, data: { action: "get_states", entities: [entity], count: 1, summary: `Ecco lo stato che vedo: ${"Salotto è accesa; ".repeat(12)}`, service: null } });
  assert.match(long.data.summary, /TextContent\("Ecco lo stato che vedo\."\)/);
});

test("optimistic tiles wait until Home Assistant reports the requested state", async () => {
  const { reports } = await import("../dist/web/action/chat/use-control.js");
  const light = { entityId: "light.desk", domain: "light", state: "off", brightness: undefined, available: true };
  assert.equal(reports(light, { state: "on" }), false);
  assert.equal(reports({ ...light, state: "on", brightness: 40 }, { state: "on" }), true);
  assert.equal(reports({ ...light, state: "on", brightness: 38 }, { state: "on", brightness: 40 }), true);
  assert.equal(reports({ ...light, state: "on", brightness: 70 }, { state: "on", brightness: 40 }), false);
  assert.equal(reports({ entityId: "climate.home", domain: "climate", state: "heat", targetTemperature: 20, available: true }, { targetTemperature: 20.5 }), false);
});
