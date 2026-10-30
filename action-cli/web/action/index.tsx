"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";

interface CliData { cwd: string; mode: "full" | "read-only" | "allowlist"; allowedCommands: string[]; timeoutMs: number; maxOutputBytes: number; shell: boolean; secretEnvironmentForwarded: boolean; }

export default function CliAction({ component, data, onSaveConfig }: MicrofrontendProps<CliData>) {
  return <MicrofrontendFrame component={component} title="CLI" description="Run commands on the server: any command (full), inspection only (read-only) or a fixed list inside the workspace (allowlist). Secrets are never forwarded.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      <div className="space-y-5"><Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Execution policy</CardTitle><Badge variant={data ? "success" : "outline"}>{data ? "Ready" : "Unavailable"}</Badge></div><CardDescription>Effective runtime boundaries.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Mode" value={data?.mode ?? "full"} /><Metric label="Secrets forwarded" value={data?.secretEnvironmentForwarded ? "Yes" : "No"} /><Metric label="Timeout" value={`${data?.timeoutMs ?? 5000} ms`} /><Metric label="Output limit" value={`${data?.maxOutputBytes ?? 32768} bytes`} /><Metric label="Workspace" value={data?.cwd ?? "Not resolved"} /></CardContent></Card>{data?.allowedCommands.length ? <Card><CardHeader><CardTitle>Allowed commands</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{data.allowedCommands.map((command) => <Badge key={command} variant="outline">{command}</Badge>)}</CardContent></Card> : null}<InstanceSummary component={component} /></div>
    </div>
  </MicrofrontendFrame>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-52 break-all text-right font-mono text-xs">{value}</span></div>; }
