import { useEffect, useState } from "react";

import type { HomeAssistantEntity } from "../../../src/index.js";
import { reading } from "./readings.js";
import { isActive } from "./select.js";
import type { useControl } from "./use-control.js";

type Control = ReturnType<typeof useControl>;
const TOGGLES = new Set(["light", "switch", "fan", "input_boolean", "media_player"]);

/** The right-hand control of a tile, picked by domain. */
export function DeviceControl({ entity, control }: { entity: HomeAssistantEntity; control: Control }) {
  if (TOGGLES.has(entity.domain)) return <PowerSwitch entity={entity} control={control} />;
  if (entity.domain === "cover") return <CoverButtons control={control} />;
  if (entity.domain === "lock") return <Pill control={control} onClick={() => control.send(entity.state === "locked" ? "unlock" : "lock", { expect: { state: entity.state === "locked" ? "unlocked" : "locked" } })}>{entity.state === "locked" ? "Unlock" : "Lock"}</Pill>;
  if (entity.domain === "scene" || entity.domain === "script") return <RunButton control={control} />;
  if (entity.domain === "climate") return <TargetStepper entity={entity} control={control} />;
  return <span className="ha-tile-reading">{reading(entity)}</span>;
}

/** Extra row under the tile, only where a single control is not enough. */
export function DeviceDetail({ entity, control }: { entity: HomeAssistantEntity; control: Control }) {
  if (entity.domain !== "light" || !isActive(entity)) return null;
  return <Brightness entity={entity} control={control} />;
}

function PowerSwitch({ entity, control }: { entity: HomeAssistantEntity; control: Control }) {
  const on = isActive(entity);
  return <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={`${entity.name} power`}
    disabled={control.disabled}
    onClick={() => control.send(on ? "turn_off" : "turn_on", { expect: { state: on ? "off" : "on" } })}
    className="ha-switch"
  />;
}

function CoverButtons({ control }: { control: Control }) {
  return <span className="ha-tile-buttons">
    <Pill control={control} onClick={() => control.send("open")} label="Open">▲</Pill>
    <Pill control={control} onClick={() => control.send("stop")} label="Stop">■</Pill>
    <Pill control={control} onClick={() => control.send("close")} label="Close">▼</Pill>
  </span>;
}

/** Runs a scene or script and confirms with a brief check mark. */
function RunButton({ control }: { control: Control }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  const run = async () => { if (await control.send("activate")) setDone(true); };
  return <Pill control={control} onClick={run}>{done ? "✓ Done" : control.busy ? "Running…" : "Run"}</Pill>;
}

function TargetStepper({ entity, control }: { entity: HomeAssistantEntity; control: Control }) {
  const target = entity.targetTemperature;
  if (target === undefined) return <span className="ha-tile-reading">{entity.currentTemperature ?? "—"}°</span>;
  const step = (delta: number) => control.send("set_temperature", { value: target + delta, expect: { targetTemperature: target + delta } });
  return <span className="ha-tile-buttons">
    <Pill control={control} onClick={() => step(-0.5)} label="Lower target">−</Pill>
    <span className="ha-tile-reading">{target}°</span>
    <Pill control={control} onClick={() => step(0.5)} label="Raise target">+</Pill>
  </span>;
}

/** Dims locally while dragging and commits once on release, so the light is not flooded with calls. `entity` is the optimistic view, so the slider never jumps back to the old level. */
function Brightness({ entity, control }: { entity: HomeAssistantEntity; control: Control }) {
  const [value, setValue] = useState(entity.brightness ?? 100);
  useEffect(() => setValue(entity.brightness ?? 100), [entity.brightness]);
  const commit = () => { if (value !== entity.brightness) void control.send("set_brightness", { value, expect: { brightness: value, state: "on" } }); };
  return <label className="ha-tile-range">
    <span>Brightness</span>
    <input
      type="range"
      min={1}
      max={100}
      value={value}
      disabled={control.disabled}
      onChange={(event) => setValue(Number(event.target.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      style={{ "--ha-fill": `${value}%` } as React.CSSProperties}
    />
    <strong>{value}%</strong>
  </label>;
}

function Pill({ control, onClick, label, children }: { control: Control; onClick(): void; label?: string; children: React.ReactNode }) {
  return <button type="button" className="ha-pill" aria-label={label} disabled={control.disabled} onClick={onClick}>{children}</button>;
}
