import { memo, useState } from "react";
import type { MicrofrontendProps } from "@agent-os/microfrontend";

import { DeviceTile } from "./device-tile.js";
import { selectEntities } from "./select.js";
import type { EntityArgs, HomeAssistantData } from "./types.js";

const PAGE = 12;

/** OpenUI component: the devices the user asked about, each with its own control. */
export const HomeDevices = memo(function HomeDevices({ data, args }: MicrofrontendProps<HomeAssistantData> & { args: EntityArgs }) {
  const [limit, setLimit] = useState(PAGE);
  if (!data) return <p className="ha-chat-empty">Loading devices…</p>;
  const devices = selectEntities(data.entities, args, (domain) => domain !== "camera");
  if (devices.length === 0) return <p className="ha-chat-empty">{data.connected ? "No matching devices." : "Home Assistant is offline."}</p>;
  const hidden = devices.length - limit;
  return <div className="ha-tiles-wrap">
    <ul className="ha-tiles">
      {devices.slice(0, limit).map((entity, index) => <DeviceTile key={entity.entityId} entity={entity} index={index} control={data.actions?.control} />)}
    </ul>
    {hidden > 0 ? <button type="button" className="ha-more" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(hidden, PAGE)} more of {hidden}</button> : null}
  </div>;
});
