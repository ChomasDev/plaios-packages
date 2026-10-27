import { useEffect, useState } from "react";

import type { HomeAssistantAction, HomeAssistantEntity } from "../../../src/index.js";
import { isActive, message } from "./select.js";
import type { HomeAssistantData } from "./types.js";

/** What a control call should change; shown right away and kept until Home Assistant reports it. */
export type Expectation = Partial<Pick<HomeAssistantEntity, "state" | "brightness" | "targetTemperature">>;
interface Pending { expect: Expectation; until: number; settleAt: number }

// Home Assistant applies most calls within a second; past this the real state wins again.
const HOLD_MS = 8_000;
// A state that already "matches" right after a call may be the old one (a second toggle before the first landed).
const SETTLE_MS = 1_500;

/**
 * Sends one control call for a tile and keeps the result optimistic: `view` is the entity as it is about to be.
 * The refresh right after a call can still carry the old state, so the expectation is held until the entity
 * matches it (or HOLD_MS passes), instead of being dropped when the request resolves.
 */
export function useControl(entity: HomeAssistantEntity, control?: HomeAssistantData["actions"]["control"]) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState("");
  // Which call has settled; tied to the call itself so a new one never inherits the previous call's flag.
  const [settled, setSettled] = useState<Pending>();

  useEffect(() => {
    if (pending && settled === pending && reports(entity, pending.expect)) setPending(undefined);
  }, [entity, pending, settled]);

  useEffect(() => {
    if (!pending) return;
    const settle = setTimeout(() => setSettled(pending), Math.max(0, pending.settleAt - Date.now()));
    const expire = setTimeout(() => setPending(undefined), Math.max(0, pending.until - Date.now()));
    return () => { clearTimeout(settle); clearTimeout(expire); };
  }, [pending]);

  /** Resolves to whether the call succeeded. */
  const send = async (action: HomeAssistantAction, options: { value?: number; option?: string; expect?: Expectation } = {}): Promise<boolean> => {
    if (!control || busy) return false;
    setBusy(true);
    setError("");
    if (options.expect) setPending({ expect: options.expect, until: Date.now() + HOLD_MS, settleAt: Date.now() + SETTLE_MS });
    try {
      await control({ entityId: entity.entityId, action, value: options.value ?? null, option: options.option ?? null });
      return true;
    } catch (reason) {
      setPending(undefined);
      setError(message(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const view: HomeAssistantEntity = pending ? { ...entity, ...pending.expect } : entity;
  return { send, busy, view, error, disabled: busy || !control || !entity.available };
}

/** Whether Home Assistant now reports what the call asked for (brightness rounds, so within 2%). */
export function reports(entity: HomeAssistantEntity, expect: Expectation): boolean {
  if (expect.state !== undefined && isActive(entity) !== isActive({ ...entity, state: expect.state })) return false;
  if (expect.brightness !== undefined && Math.abs((entity.brightness ?? -100) - expect.brightness) > 2) return false;
  if (expect.targetTemperature !== undefined && entity.targetTemperature !== expect.targetTemperature) return false;
  return true;
}
