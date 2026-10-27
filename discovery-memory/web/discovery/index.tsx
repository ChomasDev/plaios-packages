"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";
import { useState } from "react";
import type { CapabilityManifest } from "@plaios/core";
import type { DiscoveryMicrofrontendData } from "../../src/index.js";

export default function DiscoveryMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<DiscoveryMicrofrontendData>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly CapabilityManifest[] | undefined>();
  const capabilities = results ?? data?.capabilities ?? [];
  async function search() { setResults(data?.search ? await data.search({ text: query, limit: 50 }) : []); }
  return <MicrofrontendFrame component={component} title="Capability discovery" description="Inspect the live action catalog and test the deterministic token-and-tag matcher used by the orchestrator.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5"><Card><CardHeader><CardTitle>Discovery index</CardTitle><CardDescription>Search the capabilities currently registered in this runtime.</CardDescription></CardHeader><CardContent><div className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="Try: disk space, send message…" className="h-9 min-w-0 flex-1 border bg-background px-3 text-sm outline-none focus:border-ring" /><button type="button" onClick={() => void search()} className="h-9 bg-primary px-4 text-xs font-medium text-primary-foreground">Search</button></div></CardContent></Card>
        <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>{results ? "Matches" : "Registered capabilities"}</CardTitle><Badge variant="outline">{capabilities.length}</Badge></div></CardHeader><CardContent>{capabilities.length === 0 ? <div className="grid min-h-40 place-items-center border border-dashed p-6 text-sm text-muted-foreground">No capabilities are registered yet.</div> : <div className="divide-y border">{capabilities.map((capability) => <article key={`${capability.id}@${capability.version}`} className="p-4"><div className="flex items-center justify-between gap-3"><code className="text-xs font-semibold">{capability.id}</code><span className="font-mono text-[10px] text-muted-foreground">v{capability.version ?? "current"}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{capability.description}</p><div className="mt-2 flex flex-wrap gap-1">{capability.tags?.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></article>)}</div>}</CardContent></Card></div>
      <div className="space-y-5"><Card><CardHeader><CardTitle>Registry state</CardTitle><CardDescription>In-memory discovery statistics.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Capability IDs" value={String(data?.capabilityCount ?? 0)} /><Metric label="Stored versions" value={String(data?.versionCount ?? 0)} /><Metric label="Matcher" value="Exact tokens + tags" /></CardContent></Card><ConfigurationEditor component={component} onSaveConfig={onSaveConfig} /><InstanceSummary component={component} /></div>
    </div>
  </MicrofrontendFrame>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="font-mono text-xs">{value}</span></div>; }
