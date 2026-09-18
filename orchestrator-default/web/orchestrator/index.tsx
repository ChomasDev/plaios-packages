"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@agent-os/microfrontend";

interface OrchestratorData { modelProvider: string; model: string; discovery: string; minCapabilities: number; maxCapabilities: number; fastPath: boolean; instructionsMode: "default" | "custom"; }
export default function OrchestratorMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<OrchestratorData>) {
  return <MicrofrontendFrame component={component} title="Default orchestrator" description="Inspect and configure the decision layer that connects inputs, capabilities, AI routing, memory proposals, and output channels.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      <div className="space-y-5"><Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Composition</CardTitle><Badge variant={data ? "success" : "outline"}>{data ? "Ready" : "Waiting"}</Badge></div><CardDescription>Live dependencies injected by the dynamic host.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="AI provider" value={data ? `${data.modelProvider} / ${data.model}` : "Not resolved"} /><Metric label="Discovery" value={data?.discovery ?? "Not resolved"} /><Metric label="Minimum capabilities" value={String(data?.minCapabilities ?? component.config.minCapabilities ?? 30)} /><Metric label="Maximum capabilities" value={String(data?.maxCapabilities ?? component.config.maxCapabilities ?? 50)} /></CardContent></Card><Card><CardHeader><CardTitle>Routing policy</CardTitle><CardDescription>Fast-path and instruction behavior.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Fast path" value={data?.fastPath ? "Enabled" : "Disabled"} /><Metric label="Baseline tools" value={`Up to ${data?.minCapabilities ?? component.config.minCapabilities ?? 30}`} /><Metric label="Instructions" value={data?.instructionsMode ?? "default"} /><Metric label="Memory proposals" value="Up to 3 durable facts" /></CardContent></Card><InstanceSummary component={component} /></div>
    </div>
  </MicrofrontendFrame>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-48 break-all text-right font-mono text-xs">{value}</span></div>; }
