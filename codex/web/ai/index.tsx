"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";
import type { CodexProviderData } from "../types.js";

export default function CodexAIMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<CodexProviderData>) {
  return <MicrofrontendFrame component={component} title="Codex AI" description="Configure the model adapter and inspect the security boundary used for PLAIOS requests.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      <div className="space-y-5">
        <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Provider status</CardTitle><Badge variant="success">Ready</Badge></div><CardDescription>Resolved Codex runtime configuration.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Provider" value={data?.provider ?? "codex"} /><Metric label="Model" value={data?.model ?? String(component.config.model ?? "Not configured")} /><Metric label="Credentials" value={data?.credentialMode === "api-key" ? "API key" : "Local Codex session"} /><Metric label="Process" value={data?.persistentProcess === false ? "Per request" : "Persistent"} /><Metric label="Reasoning" value={data?.modelReasoningEffort ?? "Model default"} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Security boundary</CardTitle><CardDescription>Capabilities remain disabled unless explicitly enabled.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Sandbox" value={data?.sandboxMode ?? String(component.config.sandboxMode ?? "read-only")} /><Metric label="Approvals" value={data?.approvalPolicy ?? String(component.config.approvalPolicy ?? "never")} /><Metric label="Network" value={data?.networkAccessEnabled ? "Enabled" : "Disabled"} /><Metric label="Web search" value={data?.webSearchMode ?? "disabled"} /></CardContent></Card>
        <InstanceSummary component={component} />
      </div>
    </div>
    <Card><CardHeader><CardTitle>Execution context</CardTitle><CardDescription>The directory supplied to new ephemeral Codex threads.</CardDescription></CardHeader><CardContent><code className="block break-all border bg-muted/30 p-3 text-xs">{data?.workingDirectory ?? String(component.config.workingDirectory ?? "Runtime project root")}</code></CardContent></Card>
  </MicrofrontendFrame>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-48 break-all text-right font-mono text-xs">{value}</span></div>; }
