import { useEffect, useState } from "react";

import type { HomeAssistantEntity } from "../../../src/index.js";
import { relativeTime } from "./select.js";
import type { HomeAssistantData } from "./types.js";
import { useSnapshot } from "./use-snapshot.js";

/** One camera: the still fills the card, name and freshness sit on a soft gradient; click to enlarge. */
export function CameraCard({ entity, snapshot, index, expanded, onToggle }: { entity: HomeAssistantEntity; snapshot: NonNullable<HomeAssistantData["queries"]>["snapshot"] | undefined; index: number; expanded: boolean; onToggle(): void }) {
  const frame = useSnapshot(entity.entityId, entity.available ? snapshot : undefined, expanded ? "full" : "card");
  const label = useTicker(frame.at);
  return <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    aria-label={`${entity.name} camera`}
    className={`ha-cam rise-in${expanded ? " is-expanded" : ""}`}
    style={{ animationDelay: `${index * 60}ms` }}
  >
    <CameraImage name={entity.name} image={frame.image} available={entity.available} error={frame.error} />
    <span className="ha-cam-badge"><span className={`ha-cam-dot${frame.image ? " is-live" : ""}`} />{frame.image ? "Live" : entity.available ? "Connecting" : "Offline"}</span>
    <span className="ha-cam-caption">
      <span className="ha-cam-name">{entity.name}</span>
      <span className="ha-cam-meta">{[entity.area, label].filter(Boolean).join(" · ")}</span>
    </span>
  </button>;
}

function CameraImage({ name, image, available, error }: { name: string; image?: string; available: boolean; error?: string }) {
  if (image) return <img src={image} alt={`${name} snapshot`} className="ha-cam-image" draggable={false} />;
  if (!available) return <span className="ha-cam-empty">Camera offline</span>;
  if (error) return <span className="ha-cam-empty">{error}</span>;
  return <span className="ha-cam-empty ha-shimmer" aria-label="Loading" />;
}

/** "updated 3s ago" that keeps counting between snapshots. */
function useTicker(at?: string): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return at ? relativeTime(at) : "";
}
