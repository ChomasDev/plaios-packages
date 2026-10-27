"use client";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps, type OpenUIComponentModule } from "@agent-os/microfrontend";

import { WEB_SOURCES } from "../../src/ui-components.js";
import { WebSources, type SearchBridge } from "./chat/web-sources.js";

/** Renderers for the chat components the capability declares in uiComponents(). */
export const openui: OpenUIComponentModule<SearchBridge, { searchId?: string }>[] = [{ ...WEB_SOURCES, component: WebSources }];
interface SearchData { configured: boolean; provider: string; maxResults: number; recencyFilters: string[]; }
export default function SearchAction({ component, data, onSaveConfig }: MicrofrontendProps<SearchData>) { return <MicrofrontendFrame component={component} title="Perplexity web search" description="Configure live web retrieval and inspect the effective search provider without exposing its API key."><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><ConfigurationEditor component={component} onSaveConfig={onSaveConfig} /><div className="space-y-5"><Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Search provider</CardTitle><Badge variant={data?.configured ? "success" : "outline"}>{data?.configured ? "Ready" : "Needs API key"}</Badge></div><CardDescription>Runtime search limits and supported recency filters.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Provider" value={data?.provider ?? "Perplexity Search API"} /><Metric label="Maximum results" value={String(data?.maxResults ?? 20)} /><Metric label="Recency" value={(data?.recencyFilters ?? []).join(", ") || "Not resolved"} /></CardContent></Card><InstanceSummary component={component} /></div></div></MicrofrontendFrame>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-48 break-all text-right font-mono text-xs">{value}</span></div>; }
