"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";
import { useEffect, useState } from "react";
import type { EnvironmentMicrofrontendData, EnvironmentVariableDto } from "../../src/index.js";

export default function EnvironmentMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<EnvironmentMicrofrontendData>) {
  const [variables, setVariables] = useState<EnvironmentVariableDto[]>(data?.variables ?? []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => setVariables(data?.variables ?? []), [data]);
  async function save() { if (!data?.update) return; setStatus("Saving…"); try { setVariables(await data.update(drafts)); setDrafts({}); setStatus("Saved to .env"); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } }
  async function addVariable() {
    if (!data?.update) return;
    const key = newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { setStatus("Use letters, numbers, and underscores; the first character cannot be a number."); return; }
    if (variables.some((variable) => variable.key === key)) { setStatus(`${key} already exists`); return; }
    if (!newValue) { setStatus("Enter a value before adding the variable"); return; }
    setStatus("Adding…");
    try { setVariables(await data.update({ [key]: newValue })); setNewKey(""); setNewValue(""); setStatus(`Added ${key} to .env`); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }
  async function reloadRuntime() {
    setStatus("Reloading runtime…");
    try {
      const response = await fetch("/api/runtime/reload", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not reload runtime");
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
  return <MicrofrontendFrame component={component} title="Node environment" description="Resolve configuration from process variables and a project-local dotenv file without exposing secrets to the browser.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle>Environment values</CardTitle><Badge variant={data?.update ? "success" : "outline"}>{data?.source ?? component.id.split(".").at(-1)}</Badge></div><CardDescription>Add or edit project-local dotenv values. Secret-looking names are masked, and process overrides remain read-only.</CardDescription></CardHeader><CardContent className="space-y-3">
          {data?.update ? <div className="grid gap-2 border bg-muted/15 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"><input aria-label="New environment variable name" value={newKey} onChange={(event) => setNewKey(event.target.value.toUpperCase())} placeholder="VARIABLE_NAME" spellCheck={false} className="h-9 min-w-0 border bg-background px-3 font-mono text-xs outline-none focus:border-ring" /><input aria-label="New environment variable value" type={isSecretName(newKey) ? "password" : "text"} value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder={isSecretName(newKey) ? "Secret value" : "Value"} className="h-9 min-w-0 border bg-background px-3 font-mono text-xs outline-none focus:border-ring" /><Button variant="outline" disabled={!newKey.trim() || !newValue} onClick={() => void addVariable()}>Add variable</Button></div> : null}
          {variables.length === 0 ? <div className="grid min-h-32 place-items-center border border-dashed p-6 text-center text-sm text-muted-foreground">No dotenv values yet. Add the first variable above.</div> : <div className="grid gap-3 md:grid-cols-2">{variables.map((variable) => <VariableField key={variable.key} variable={variable} value={drafts[variable.key] ?? (variable.secret ? "" : variable.value)} onChange={(value) => setDrafts((current) => ({ ...current, [variable.key]: value }))} />)}</div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="min-w-0 flex-1 text-xs text-muted-foreground">{status}</p><div className="flex gap-2"><Button variant="outline" disabled={!data?.update} onClick={() => void reloadRuntime()}>Reload runtime</Button><Button disabled={!data?.update || Object.keys(drafts).length === 0} onClick={() => void save()}>Save .env</Button></div></div>
        </CardContent></Card>
        <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      </div>
      <div className="space-y-5"><Card><CardHeader><CardTitle>Resolution</CardTitle><CardDescription>Effective adapter state.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><Metric label="Source" value={data?.source ?? "unknown"} /><Metric label="Providers" value={String(data?.providerCount ?? 1)} /><Metric label="Configured" value={String(data?.configuredCount ?? 0)} /><Metric label="Visible keys" value={String(variables.length)} /></CardContent></Card><InstanceSummary component={component} /></div>
    </div>
  </MicrofrontendFrame>;
}

function VariableField({ variable, value, onChange }: { variable: EnvironmentVariableDto; value: string; onChange(value: string): void }) { return <label className="block border bg-muted/15 p-3"><span className="mb-2 flex items-center justify-between gap-3"><code className="text-xs font-semibold">{variable.key}</code><span className="flex gap-1"><Badge variant="outline">{variable.source}</Badge><Badge variant={variable.isSet ? "success" : "outline"}>{variable.isSet ? "set" : "unset"}</Badge></span></span><input type={variable.secret ? "password" : "text"} value={value} placeholder={variable.secret ? variable.displayValue : "Not set"} disabled={variable.source === "process"} onChange={(event) => onChange(event.target.value)} className="h-9 w-full border bg-background px-3 font-mono text-xs outline-none focus:border-ring disabled:opacity-50" /></label>; }
function isSecretName(key: string): boolean { return /(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|COOKIE)/i.test(key); }
function Metric({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="font-mono text-xs">{value}</span></div>; }
