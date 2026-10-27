import { memo, useState } from "react";
import type { MicrofrontendProps } from "@agent-os/microfrontend";

import { CameraCard } from "./camera-card.js";
import { selectEntities } from "./select.js";
import type { EntityArgs, HomeAssistantData } from "./types.js";

/** OpenUI component: the cameras the user asked for, as live cards. */
export const HomeCameras = memo(function HomeCameras({ data, args }: MicrofrontendProps<HomeAssistantData> & { args: EntityArgs }) {
  const [expanded, setExpanded] = useState<string>();
  if (!data) return <p className="ha-chat-empty">Loading cameras…</p>;
  const cameras = selectEntities(data.entities, args, (domain) => domain === "camera");
  if (cameras.length === 0) return <p className="ha-chat-empty">{data.connected ? "No matching cameras." : "Home Assistant is offline."}</p>;
  return <div className="ha-cams">
    {cameras.map((entity, index) => <CameraCard
      key={entity.entityId}
      entity={entity}
      index={index}
      snapshot={data.queries?.snapshot}
      expanded={expanded === entity.entityId}
      onToggle={() => setExpanded(expanded === entity.entityId ? undefined : entity.entityId)}
    />)}
  </div>;
});
