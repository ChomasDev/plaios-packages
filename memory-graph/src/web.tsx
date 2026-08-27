"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@agent-os/microfrontend";
import { GraphStatus, NodeDetails } from "./graph-controls.js";
import { GraphExplorer } from "./graph-explorer.js";
import { nodeById, type GraphData } from "./graph-view-model.js";

export default function GraphMemoryMicrofrontend({
  component,
  data,
}: MicrofrontendProps<GraphData>) {
  const [snapshot, setSnapshot] = useState(data);
  const [content, setContent] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setSnapshot(data), [data]);
  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot?.nodes]);
  const edges = useMemo(() => snapshot?.edges ?? [], [snapshot?.edges]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const onSelect = useCallback((id?: string) => setSelectedId(id), []);
  const selected = nodeById(nodes, selectedId);

  const run = useCallback(async (operation: () => Promise<GraphData>) => {
    setBusy(true);
    try {
      setSnapshot(await operation());
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <MicrofrontendFrame
      component={component}
      title="WebGL graph explorer"
      description="Sigma.js renders the graph with WebGL while ForceAtlas2 continuously computes gravity in a background worker. Drag nodes, pan, zoom, search, inspect, or pause the layout."
    >
      <section className="agentos-memory-graph overflow-hidden border bg-card">
        <form
          className="graph-create grid gap-2 border-b p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!snapshot?.actions?.remember || !content.trim()) return;
            void run(() => snapshot.actions!.remember({ content, userId })).then(() => setContent(""));
          }}
        >
          <input
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Add a memory…"
            className="h-9 border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="User ID (optional)"
            className="h-9 border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button disabled={busy || !content.trim()} className="h-9 border bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Remember
          </button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter loaded nodes…"
            className="h-9 min-w-56 flex-1 border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring md:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <GraphStatus
              shownNodes={nodes.length}
              shownEdges={edges.length}
              totalNodes={snapshot?.totalNodes ?? nodes.length}
              totalEdges={snapshot?.totalEdges ?? edges.length}
              nodeLimit={snapshot?.nodeLimit ?? nodes.length}
            />
            <button type="button" disabled={busy} onClick={() => snapshot?.actions?.refresh && void run(snapshot.actions.refresh)} className="h-8 border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">Refresh</button>
            <button type="button" disabled={busy || nodes.length === 0} onClick={() => snapshot?.actions?.clear && window.confirm("Clear every graph memory?") && void run(snapshot.actions.clear)} className="h-8 border border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Clear all</button>
          </div>
        </div>
        <div className="graph-stage relative bg-slate-950">
          <GraphExplorer
            nodes={nodes}
            edges={edges}
            query={query}
            selectedId={selectedId}
            onSelect={onSelect}
          />
          {!snapshot?.available && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="font-medium">Graph store not initialized</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start the agent once to create the SQLite graph tables.
                </p>
              </div>
            </div>
          )}
          <NodeDetails node={selected} onForget={snapshot?.actions?.forget ? (id) => void run(() => snapshot.actions!.forget(id)).then(() => setSelectedId(undefined)) : undefined} />
        </div>
      </section>
    </MicrofrontendFrame>
  );
}
