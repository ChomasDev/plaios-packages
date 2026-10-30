"use client";
import { useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";

import type { T3Dashboard } from "../../src/index.js";

export default function T3CodeAction({ component, data, onSaveConfig }: MicrofrontendProps<T3Dashboard>) {
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState("");
  const open = async (id: string) => {
    if (!data) return;
    setBusy(id);
    try {
      setMessage(await data.actions.open(id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <MicrofrontendFrame component={component} title="T3 Code" description="Coding agents and projects in T3 Code on your Mac, over Tailscale.">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Projects</CardTitle>
                <Badge variant={data?.reachable ? "success" : "outline"}>{data?.reachable ? "Connected" : "Unreachable"}</Badge>
              </div>
              <CardDescription className="break-all font-mono text-xs">{data?.url ?? "No MCP URL"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {message && <p className="text-muted-foreground" role="status">{message}</p>}
              {(data?.projects ?? []).map((project) => (
                <div key={project.id} className="flex items-center justify-between gap-3">
                  <span className="truncate" title={project.workspaceRoot}>{project.title}</span>
                  <Button size="sm" variant="outline" disabled={busy !== undefined} onClick={() => void open(project.id)}>
                    {busy === project.id ? "Opening…" : "Open on Mac"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          <InstanceSummary component={component} />
        </div>
      </div>
    </MicrofrontendFrame>
  );
}
