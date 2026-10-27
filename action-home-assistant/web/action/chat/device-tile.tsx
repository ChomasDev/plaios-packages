import type { HomeAssistantEntity } from "../../../src/index.js";
import { DeviceControl, DeviceDetail } from "./device-controls.js";
import { isActive } from "./select.js";
import type { HomeAssistantData } from "./types.js";
import { useControl } from "./use-control.js";

const ICONS: Record<string, string> = { light: "☼", switch: "⏻", fan: "✣", cover: "↕", lock: "◇", climate: "≋", scene: "✦", script: "▶", input_boolean: "◉", media_player: "▣", sensor: "◔", binary_sensor: "◐", camera: "◎" };

export function DeviceTile({ entity, index, control: controlFn }: { entity: HomeAssistantEntity; index: number; control?: HomeAssistantData["actions"]["control"] }) {
  const control = useControl(entity, controlFn);
  // Everything below renders the optimistic view, so a toggle never flickers back while Home Assistant catches up.
  const shown = control.view;
  const active = isActive(shown);
  return <li className={`ha-tile rise-in${active ? " is-active" : ""}${entity.available ? "" : " is-unavailable"}`} style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}>
    <div className="ha-tile-row">
      <span className="ha-tile-icon" aria-hidden="true">{ICONS[entity.domain] ?? "•"}</span>
      <span className="ha-tile-text">
        <span className="ha-tile-name">{entity.name}</span>
        <span className="ha-tile-meta">{control.error || [shown.area, caption(shown)].filter(Boolean).join(" · ")}</span>
      </span>
      <DeviceControl entity={shown} control={control} />
    </div>
    <DeviceDetail entity={shown} control={control} />
  </li>;
}

function caption(entity: HomeAssistantEntity): string {
  if (!entity.available) return "Unavailable";
  if (entity.domain === "media_player" && entity.mediaTitle) return entity.mediaTitle;
  if (entity.domain === "climate" && entity.currentTemperature !== undefined) return `${entity.currentTemperature}° now`;
  if (entity.domain === "sensor" || entity.domain === "binary_sensor") return entity.deviceClass?.replace(/_/g, " ") ?? "";
  return entity.state;
}
