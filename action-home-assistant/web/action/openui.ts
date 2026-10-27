import type { OpenUIComponentSpec } from "@agent-os/microfrontend";

const query = { name: "query", type: "string", optional: true, description: "Words matched against the device name, area and entity id, for example \"garage\" or \"cucina\"; omit to show all." } as const;
const entityIds = { name: "entityIds", type: "string[]", optional: true, description: "Exact entity ids, when a tool call already told you which ones; takes precedence over query." } as const;

/** Shared by the backend (prompt) and the web module (renderer) so the model and the browser agree on the components. */
export const HOME_CAMERAS_OPENUI: OpenUIComponentSpec = {
  name: "HomeCameras",
  description: "Live Home Assistant camera snapshots as a grid of cards that refresh by themselves. Use it whenever the user wants to see cameras, e.g. \"show me the garage cameras\" -> HomeCameras(\"garage\"). It needs no tool call.",
  props: [query, entityIds],
};

export const HOME_DEVICES_OPENUI: OpenUIComponentSpec = {
  name: "HomeDevices",
  description: "Live Home Assistant devices as compact tiles with their own controls: switches, lights and fans toggle, lights dim, covers open and close, scenes and scripts run, sensors show their reading. Use it when the user wants to see or control devices or readings, e.g. HomeDevices(\"salotto\") or HomeDevices(\"temperatura\"). It needs no tool call.",
  props: [query, entityIds],
};

export const HOME_ASSISTANT_OPENUI = [HOME_CAMERAS_OPENUI, HOME_DEVICES_OPENUI];
