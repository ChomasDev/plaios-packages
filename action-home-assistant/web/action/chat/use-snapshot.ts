import { useEffect, useRef, useState } from "react";

import type { HomeAssistantData } from "./types.js";

const REFRESH_MS = 8_000;

interface SnapshotState { image?: string; at?: string; error?: string }

/** Polls one camera still; slows down while the tab is hidden and stops when unmounted. */
export function useSnapshot(entityId: string, snapshot: NonNullable<HomeAssistantData["queries"]>["snapshot"] | undefined, size: "card" | "full" = "card"): SnapshotState {
  const [state, setState] = useState<SnapshotState>({});
  // Bridge functions are recreated on every data refresh; polling must not restart with them.
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const available = Boolean(snapshot);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await latest.current!(entityId, size);
        if (alive) setState({ image: result.image, at: result.at });
      } catch (reason) {
        if (alive) setState((previous) => ({ ...previous, error: reason instanceof Error ? reason.message : String(reason) }));
      }
      if (alive) timer = setTimeout(load, document.hidden ? REFRESH_MS * 4 : REFRESH_MS);
    };
    void load();
    return () => { alive = false; clearTimeout(timer); };
  }, [entityId, size, available]);

  return state;
}
