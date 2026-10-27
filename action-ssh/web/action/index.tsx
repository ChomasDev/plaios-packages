"use client";

import { useEffect, useState } from "react";
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
} from "@plaios/microfrontend";
import type { PublicDevice, SshControlInput, SshDashboard } from "../../src/index.js";

export default function SshAction({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<SshDashboard>) {
  const [dashboard, setDashboard] = useState<SshDashboard | undefined>(data);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [lastSummary, setLastSummary] = useState("");

  useEffect(() => setDashboard(data), [data]);

  async function run(input: SshControlInput): Promise<void> {
    if (!data?.actions.control) return;
    setBusy(`${input.deviceId ?? "all"}:${input.action}`);
    setError("");
    try {
      const result = await data.actions.control(input);
      setLastSummary(result.summary);
      setDashboard((current) => current ? { ...current, devices: result.devices, updatedAt: new Date().toISOString() } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <MicrofrontendFrame
      component={component}
      title="Remote computers"
      description="Pair Macs with Agent OS Remote, then control them over SSH from this server. Private keys stay on the runtime."
    >
      <div className="ssh-stack">
        <section className="ssh-overview">
          <div>
            <Badge variant={(dashboard?.devices.length ?? 0) > 0 ? "success" : "outline"}>
              {(dashboard?.devices.length ?? 0) > 0 ? "Paired" : "No devices"}
            </Badge>
            <h2>Control a Mac from the villa.</h2>
            <p>Install Agent OS Remote on each Mac, paste the server public key, then add host, user, and the private key path here.</p>
          </div>
          <div className="ssh-metrics">
            <div><strong>{String(dashboard?.devices.length ?? 0).padStart(2, "0")}</strong><span>Devices</span></div>
            <div><strong>{String(dashboard?.devices.filter((device) => device.hasKey).length ?? 0).padStart(2, "0")}</strong><span>With keys</span></div>
          </div>
        </section>

        {error ? <div className="ssh-error" role="alert">{error}</div> : null}
        {lastSummary ? <p className="ssh-summary">{lastSummary}</p> : null}

        <div className="ssh-grid">
          {(dashboard?.devices ?? []).map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              busy={busy}
              onStatus={() => run({ deviceId: device.id, action: "status" })}
              onLock={() => run({ deviceId: device.id, action: "lock" })}
            />
          ))}
          {(dashboard?.devices ?? []).length === 0 ? (
            <div className="ssh-empty">No computers yet. Add a device in the configuration, then open Agent OS Remote on the Mac.</div>
          ) : null}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Pairing</CardTitle>
                <CardDescription>The Mac app installs your public key and enables Remote Login. This screen never receives the private key.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>1. Generate <code>ssh-keygen -t ed25519 -f ~/.ssh/agent-os-mac</code> on the server.</p>
                <p>2. Open Agent OS Remote on the Mac and paste <code>agent-os-mac.pub</code>.</p>
                <p>3. Save host, user, and <code>privateKeyPath</code> in the devices JSON.</p>
                <Button variant="outline" onClick={() => data?.actions.refresh().then(setDashboard)}>Refresh</Button>
              </CardContent>
            </Card>
            <InstanceSummary component={component} />
          </div>
        </div>
      </div>
    </MicrofrontendFrame>
  );
}

function DeviceCard({
  device,
  busy,
  onStatus,
  onLock,
}: {
  device: PublicDevice;
  busy?: string;
  onStatus(): Promise<void>;
  onLock(): Promise<void>;
}) {
  const working = busy?.startsWith(`${device.id}:`);
  return (
    <article className="ssh-device">
      <header>
        <div>
          <h3>{device.name}</h3>
          <p>{device.user}@{device.host}:{device.port}</p>
        </div>
        <Badge variant={device.hasKey ? "success" : "outline"}>{device.os}</Badge>
      </header>
      <div className="ssh-device-actions">
        <button type="button" disabled={working || !device.hasKey} onClick={onStatus}>
          {working ? "Working…" : "Status"}
        </button>
        <button type="button" disabled={working || !device.hasKey} onClick={onLock}>Lock</button>
      </div>
    </article>
  );
}
