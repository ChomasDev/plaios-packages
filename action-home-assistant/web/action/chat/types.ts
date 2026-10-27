import type { CameraSnapshot, HomeAssistantControlInput, HomeAssistantDashboard } from "../../../src/index.js";

/** Bridge data as the browser sees it: actions refresh the data afterwards, queries only read. */
export interface HomeAssistantData extends HomeAssistantDashboard {
  actions: {
    refresh(): Promise<HomeAssistantDashboard>;
    control(input: HomeAssistantControlInput): Promise<HomeAssistantDashboard>;
  };
  queries?: {
    snapshot(entityId: string, size?: "card" | "full"): Promise<CameraSnapshot>;
  };
}

export interface EntityArgs { query?: string; entityIds?: string[] }
