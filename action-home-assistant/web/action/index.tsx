"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfigurationEditor,
  InstanceSummary,
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@agent-os/microfrontend";
import type {
  HomeAssistantAction,
  HomeAssistantControlInput,
  HomeAssistantDashboard,
  HomeAssistantEntity,
} from "../../src/index.js";
import { CameraCard } from "./chat/camera-card.js";
import { HomeCameras } from "./chat/home-cameras.js";
import { HomeDevices } from "./chat/home-devices.js";
import { reading } from "./chat/readings.js";
import type { HomeAssistantData } from "./chat/types.js";
import { HOME_CAMERAS_OPENUI, HOME_DEVICES_OPENUI } from "./openui.js";

export const openui = [
  { ...HOME_CAMERAS_OPENUI, component: HomeCameras },
  { ...HOME_DEVICES_OPENUI, component: HomeDevices },
];

const domainLabels: Record<string, string> = {
  light: "Lights",
  switch: "Switches",
  fan: "Fans",
  cover: "Covers",
  lock: "Locks",
  climate: "Climate",
  scene: "Scenes",
  script: "Scripts",
  input_boolean: "Helpers",
  media_player: "Media",
  camera: "Cameras",
  sensor: "Sensors",
  binary_sensor: "Detectors",
};

export default function HomeAssistantAction({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<HomeAssistantData>) {
  const [dashboard, setDashboard] = useState<HomeAssistantDashboard | undefined>(data);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");

  useEffect(() => setDashboard(data), [data]);

  const domains = useMemo(
    () => [...new Set((dashboard?.entities ?? []).map((entity) => entity.domain))],
    [dashboard?.entities],
  );
  const entities = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (dashboard?.entities ?? []).filter((entity) =>
      (domain === "all" || entity.domain === domain) &&
      (!query || `${entity.name} ${entity.entityId} ${entity.state}`.toLowerCase().includes(query)),
    );
  }, [dashboard?.entities, domain, search]);

  async function refresh(): Promise<void> {
    if (!data?.actions.refresh) return;
    setBusy("refresh");
    setError("");
    try {
      setDashboard(await data.actions.refresh());
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function control(input: HomeAssistantControlInput): Promise<void> {
    if (!data?.actions.control) return;
    setBusy(input.entityId ?? undefined);
    setError("");
    try {
      setDashboard(await data.actions.control(input));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(undefined);
    }
  }

  const online = dashboard?.entities.filter((entity) => entity.available).length ?? 0;
  const active = dashboard?.entities.filter(isActive).length ?? 0;

  return (
    <MicrofrontendFrame
      component={component}
      title="Home Assistant"
      description="A live control surface for the entities exposed by your Home Assistant instance. Credentials remain in the Agent OS runtime."
    >
      <div className="ha-stack">
        <section className="ha-overview">
          <div className="ha-overview-copy">
            <div className="ha-status-line">
              <Badge variant={dashboard?.connected ? "success" : "outline"}>
                {dashboard?.connected ? "Connected" : "Offline"}
              </Badge>
              <span className="ha-endpoint">{dashboard?.baseUrl ?? "Waiting for configuration"}</span>
            </div>
            <h2>Your home, in one place.</h2>
            <p>Devices and available controls are discovered from Home Assistant on every refresh.</p>
          </div>
          <div className="ha-metrics">
            <Metric value={String(dashboard?.entities.length ?? 0).padStart(2, "0")} label="Entities" />
            <Metric value={String(online).padStart(2, "0")} label="Online" />
            <Metric value={String(active).padStart(2, "0")} label="Active" />
          </div>
        </section>

        {dashboard?.error || error ? (
          <div className="ha-error" role="alert">{error || dashboard?.error}</div>
        ) : null}

        <section className="ha-toolbar" aria-label="Entity controls">
          <label className="ha-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search entity or room…"
              aria-label="Search Home Assistant entities"
            />
          </label>
          <div className="ha-filters" role="group" aria-label="Entity domain">
            <Filter active={domain === "all"} onClick={() => setDomain("all")}>All</Filter>
            {domains.map((item) => (
              <Filter key={item} active={domain === item} onClick={() => setDomain(item)}>
                {domainLabels[item] ?? item}
              </Filter>
            ))}
          </div>
          <Button variant="outline" onClick={refresh} disabled={busy === "refresh" || !data?.actions.refresh}>
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </section>

        {entities.length ? (
          <div className="ha-grid">
            {entities.map((entity) => (
              <EntityCard
                key={entity.entityId}
                entity={entity}
                snapshot={data?.queries?.snapshot}
                busy={busy === entity.entityId}
                onControl={control}
              />
            ))}
          </div>
        ) : (
          <div className="ha-empty">
            <span>{dashboard?.connected ? "No entities match this view." : "Connect Home Assistant to discover your devices."}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Live connection</CardTitle>
                <CardDescription>The access token is resolved server-side and never sent to this screen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Status" value={dashboard?.connected ? "Connected" : "Unavailable"} />
                <Row label="Last sync" value={formatTime(dashboard?.updatedAt)} />
                <Row label="Domains" value={domains.join(", ") || "Not resolved"} />
              </CardContent>
            </Card>
            <InstanceSummary component={component} />
          </div>
        </div>
      </div>
    </MicrofrontendFrame>
  );
}

function EntityCard({
  entity,
  snapshot,
  busy,
  onControl,
}: {
  entity: HomeAssistantEntity;
  snapshot?: NonNullable<HomeAssistantData["queries"]>["snapshot"];
  busy: boolean;
  onControl(input: HomeAssistantControlInput): Promise<void>;
}) {
  const [value, setValue] = useState(entitySetting(entity));
  const [option, setOption] = useState(entity.state);

  useEffect(() => {
    setValue(entitySetting(entity));
    setOption(entity.state);
  }, [entity]);

  const send = (action: HomeAssistantAction, nextValue: number | null = null, nextOption: string | null = null) =>
    onControl({ entityId: entity.entityId, action, value: nextValue, option: nextOption });

  return (
    <article className={`ha-entity ${isActive(entity) ? "is-active" : ""} ${!entity.available ? "is-unavailable" : ""}`}>
      <header>
        <div className="ha-device-icon" aria-hidden="true">{domainIcon(entity.domain)}</div>
        <div className="ha-entity-title">
          <h3>{entity.name}</h3>
          <p>{entity.entityId}</p>
        </div>
        <span className="ha-state">{busy ? "Working…" : entity.state}</span>
      </header>
      <div className="ha-entity-body">
        {entity.domain === "camera" ? <CameraPreview entity={entity} snapshot={snapshot} /> : null}
        <EntityControls entity={entity} value={value} option={option} busy={busy} setValue={setValue} setOption={setOption} send={send} />
      </div>
      <footer>
        <span>{domainLabels[entity.domain] ?? entity.domain}</span>
        <span>{entity.available ? `Updated ${relativeTime(entity.lastChanged)}` : "Unavailable"}</span>
      </footer>
    </article>
  );
}

function EntityControls({
  entity,
  value,
  option,
  busy,
  setValue,
  setOption,
  send,
}: {
  entity: HomeAssistantEntity;
  value: number;
  option: string;
  busy: boolean;
  setValue(value: number): void;
  setOption(value: string): void;
  send(action: HomeAssistantAction, value?: number | null, option?: string | null): Promise<void>;
}) {
  const disabled = busy || !entity.available;
  if (["light", "switch", "fan", "input_boolean"].includes(entity.domain)) {
    return <>
      <button className="ha-primary-control" type="button" disabled={disabled} onClick={() => send(isActive(entity) ? "turn_off" : "turn_on")}>
        <span className="ha-power" aria-hidden="true">⌁</span>
        {isActive(entity) ? "Turn off" : "Turn on"}
      </button>
      {entity.domain === "light" ? <RangeControl label="Brightness" value={value} suffix="%" disabled={disabled} onChange={setValue} onApply={() => send("set_brightness", value)} /> : null}
    </>;
  }
  if (entity.domain === "cover") {
    return <>
      <div className="ha-button-row">
        <SmallButton disabled={disabled} onClick={() => send("open")}>Open</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("stop")}>Stop</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("close")}>Close</SmallButton>
      </div>
      <RangeControl label="Position" value={value} suffix="%" disabled={disabled} onChange={setValue} onApply={() => send("set_position", value)} />
    </>;
  }
  if (entity.domain === "lock") {
    return <button className="ha-primary-control" type="button" disabled={disabled} onClick={() => send(entity.state === "locked" ? "unlock" : "lock")}>
      {entity.state === "locked" ? "Unlock" : "Lock"}
    </button>;
  }
  if (entity.domain === "climate") {
    return <>
      <div className="ha-temperature"><span>{entity.currentTemperature ?? "—"}°</span><small>Current</small></div>
      <RangeControl label="Target" min={5} max={35} step={0.5} value={value} suffix="°" disabled={disabled} onChange={setValue} onApply={() => send("set_temperature", value)} />
      {entity.hvacModes?.length ? <div className="ha-select-row"><select value={option} onChange={(event) => setOption(event.target.value)} disabled={disabled}>{entity.hvacModes.map((mode) => <option key={mode}>{mode}</option>)}</select><SmallButton disabled={disabled} onClick={() => send("set_hvac_mode", null, option)}>Set mode</SmallButton></div> : null}
    </>;
  }
  if (entity.domain === "media_player") {
    return <>
      <button className="ha-primary-control" type="button" disabled={disabled} onClick={() => send(isActive(entity) ? "turn_off" : "turn_on")}>
        <span className="ha-power" aria-hidden="true">⌁</span>
        {isActive(entity) ? "Turn off" : "Turn on"}
      </button>
      <RangeControl label="Volume" value={value} suffix="%" disabled={disabled} onChange={setValue} onApply={() => send("set_volume", value)} />
      <div className="ha-button-row">
        <SmallButton disabled={disabled} onClick={() => send(entity.muted ? "unmute" : "mute")}>{entity.muted ? "Unmute" : "Mute"}</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("volume_down")}>Vol −</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("volume_up")}>Vol +</SmallButton>
      </div>
      <div className="ha-button-row">
        <SmallButton disabled={disabled} onClick={() => send("media_play")}>Play</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("media_pause")}>Pause</SmallButton>
        <SmallButton disabled={disabled} onClick={() => send("media_stop")}>Stop</SmallButton>
      </div>
    </>;
  }
  if (entity.domain === "scene" || entity.domain === "script") {
    return <button className="ha-primary-control" type="button" disabled={disabled} onClick={() => send("activate")}>Activate</button>;
  }
  if (entity.domain === "sensor" || entity.domain === "binary_sensor") {
    return <div className="ha-temperature"><span>{reading(entity)}</span></div>;
  }
  if (entity.domain === "camera") return null;
  return <p className="ha-no-controls">No controls available for this entity.</p>;
}

function CameraPreview({ entity, snapshot }: { entity: HomeAssistantEntity; snapshot?: NonNullable<HomeAssistantData["queries"]>["snapshot"] }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="ha-cams is-single"><CameraCard entity={entity} snapshot={snapshot} index={0} expanded={expanded} onToggle={() => setExpanded(!expanded)} /></div>;
}

function RangeControl({ label, value, suffix, min = 0, max = 100, step = 1, disabled, onChange, onApply }: { label: string; value: number; suffix: string; min?: number; max?: number; step?: number; disabled: boolean; onChange(value: number): void; onApply(): void }) {
  return <div className="ha-range"><div><span>{label}</span><strong>{value}{suffix}</strong></div><div className="ha-range-controls"><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /><button type="button" disabled={disabled} onClick={onApply}>Apply</button></div></div>;
}

function Filter({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} onClick={onClick}>{children}</button>;
}

function SmallButton({ disabled, onClick, children }: { disabled: boolean; onClick(): void; children: React.ReactNode }) {
  return <button className="ha-small-button" type="button" disabled={disabled} onClick={onClick}>{children}</button>;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-52 break-all text-right font-mono text-xs">{value}</span></div>;
}

function entitySetting(entity: HomeAssistantEntity): number {
  if (entity.domain === "light") return entity.brightness ?? (isActive(entity) ? 100 : 0);
  if (entity.domain === "cover") return entity.position ?? 0;
  if (entity.domain === "climate") return entity.targetTemperature ?? entity.currentTemperature ?? 20;
  if (entity.domain === "media_player") return entity.volume ?? 20;
  return 0;
}

function isActive(entity: HomeAssistantEntity): boolean {
  return !["off", "closed", "locked", "unavailable", "unknown"].includes(entity.state);
}

function domainIcon(domain: string): string {
  return ({ light: "☼", switch: "⏻", fan: "✣", cover: "↕", lock: "◇", climate: "≋", scene: "✦", script: "▶", input_boolean: "◉", media_player: "▣", camera: "◎", sensor: "◔", binary_sensor: "◐" } as Record<string, string>)[domain] ?? "•";
}

function formatTime(value?: string): string {
  if (!value) return "Not synced";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
