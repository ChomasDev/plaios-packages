"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";
import type { ClaudeCodeProviderData } from "../types.js";

export default function ClaudeCodeAIMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<ClaudeCodeProviderData>) {
  return <MicrofrontendFrame component={component} title="Claude Code AI" description="Run the agent's model requests through Claude, with your Claude Code login or an Anthropic API key.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      <div className="space-y-5">
        <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Provider status</CardTitle><Badge variant="success">Ready</Badge></div><CardDescription>Resolved Claude Code runtime configuration.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Provider" value={data?.provider ?? "claude-code"} /><Metric label="Model" value={data?.model ?? String(component.config.model ?? "claude-opus-5-5")} /><Metric label="Credentials" value={data?.credentialMode === "api-key" ? "API key" : "Local Claude Code login"} /><Metric label="Effort" value={data?.effort ?? "model default"} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Security boundary</CardTitle><CardDescription>Claude only sees the request and the PLAIOS capabilities.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Built-in tools" value="Disabled" /><Metric label="User settings and MCP" value="Not loaded" /><Metric label="Sessions on disk" value="Not saved" /></CardContent></Card>
        <InstanceSummary component={component} />
      </div>
    </div>
    <Card><CardHeader><CardTitle>Execution context</CardTitle><CardDescription>The directory the Claude Code process runs in.</CardDescription></CardHeader><CardContent><code className="block break-all border bg-muted/30 p-3 text-xs">{data?.workingDirectory ?? String(component.config.workingDirectory ?? "Runtime project root")}</code></CardContent></Card>
  </MicrofrontendFrame>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-48 break-all text-right font-mono text-xs">{value}</span></div>; }
