import type { HomeAssistantEntity } from "../../../src/index.js";

const OPENINGS = new Set(["door", "window", "opening", "garage_door"]);
const PRESENCE = new Set(["motion", "occupancy", "presence", "moving"]);

/** A sensor's state as a person would say it: a rounded number with its unit, or open/closed, detected/clear. */
export function reading(entity: HomeAssistantEntity): string {
  if (!entity.available) return "Unavailable";
  if (entity.domain === "binary_sensor") return binaryReading(entity);
  const value = Number(entity.state);
  if (entity.state.trim() === "" || Number.isNaN(value)) return entity.state;
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return entity.unit ? `${rounded} ${entity.unit}` : String(rounded);
}

function binaryReading(entity: HomeAssistantEntity): string {
  const on = entity.state === "on";
  if (OPENINGS.has(entity.deviceClass ?? "")) return on ? "Open" : "Closed";
  if (PRESENCE.has(entity.deviceClass ?? "")) return on ? "Detected" : "Clear";
  return on ? "On" : "Off";
}
