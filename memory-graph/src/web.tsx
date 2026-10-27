"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@plaios/microfrontend";
import { GraphStatus, NodeDetails } from "./graph-controls.js";
import { GraphExplorer } from "./graph-explorer.js";
import { GraphExplorer3D } from "./graph-explorer-3d.js";
import type { GraphData } from "./graph-view-model.js";
import { bestMatch, neighborhood } from "./graph-focus.js";
import { MEMORY_GRAPH_OPENUI } from "./openui.js";

type EdgeMode = "context" | "all";
type RenderMode = "3d" | "2d";

export default function GraphMemoryMicrofrontend({
  component,
  data,
}: MicrofrontendProps<GraphData>) {
  const [snapshot, setSnapshot] = useState(data);
  const [content, setContent] = useState("");
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  // Deep link from chat: #component/<instance>?node=<id> opens the explorer on that node.
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("node") ?? undefined);
  const [hiddenTypes, setHiddenTypes] = useState<string[]>([]);
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("all");
  const [renderMode, setRenderMode] = useState<RenderMode>("3d");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => setSnapshot(data), [data]);
  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot?.nodes]);
  const edges = useMemo(() => snapshot?.edges ?? [], [snapshot?.edges]);
  const selected = nodes.find((node) => node.id === selectedId);
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [nodes]);
  const visibleNodeCount = nodes.filter(({ type }) => !hiddenTypes.includes(type)).length;
  const connectionCount = selectedId
    ? edges.filter(({ sourceId, targetId }) => sourceId === selectedId || targetId === selectedId).length
    : 0;
  const visibleEdgeCount = edgeMode === "all" ? edges.length : connectionCount;

  const run = useCallback(async (operation: () => Promise<GraphData>) => {
    setBusy(true);
    setError(undefined);
    try {
      setSnapshot(await operation());
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(false);
    }
  }, []);

  function toggleType(type: string) {
    setHiddenTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    );
    if (selected?.type === type) setSelectedId(undefined);
  }

  return (
    <MicrofrontendFrame
      component={component}
      title="Memory graph console"
      description="Inspect the persisted property graph, isolate entity types, trace local relationships, and manage memory without turning the canvas into an unreadable edge cloud."
    >
      <section className="agentos-memory-graph">
        <div className="graph-metrics">
          <GraphMetric label="Graph status" value={snapshot?.available ? "INDEXED" : "OFFLINE"} live={snapshot?.available} />
          <GraphMetric label="Nodes" value={formatCount(snapshot?.totalNodes ?? nodes.length)} />
          <GraphMetric label="Edges" value={formatCount(snapshot?.totalEdges ?? edges.length)} />
          <GraphMetric label="Entity types" value={String(typeCounts.length).padStart(2, "0")} />
        </div>

        <div className="graph-terminal-bar">
          <span className="graph-terminal-prompt">memory.remember</span>
          <form
            className="graph-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (!snapshot?.actions?.remember || !content.trim()) return;
              void run(() => snapshot.actions!.remember({ content, userId })).then(() => setContent(""));
            }}
          >
            <input value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write a durable semantic memory…" />
            <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="user: global" />
            <button disabled={busy || !content.trim()}>{busy ? "WRITING…" : "COMMIT"}</button>
          </form>
        </div>

        {error ? <div className="graph-error">{error}</div> : null}

        <div className="graph-workspace border bg-card">
          <header className="graph-toolbar">
            <label className="graph-search">
              <span>/</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by label, type, id, or date…" />
              <kbd>LIVE</kbd>
            </label>
            <div className="graph-toolbar-group">
              <span className="graph-toolbar-label">VIEW</span>
              <button type="button" className={renderMode === "3d" ? "active" : ""} onClick={() => setRenderMode("3d")}>3D</button>
              <button type="button" className={renderMode === "2d" ? "active" : ""} onClick={() => setRenderMode("2d")}>2D</button>
            </div>
            <div className="graph-toolbar-group">
              <span className="graph-toolbar-label">EDGES</span>
              <button type="button" className={edgeMode === "context" ? "active" : ""} onClick={() => setEdgeMode("context")}>CONTEXT</button>
              <button type="button" className={edgeMode === "all" ? "active" : ""} onClick={() => setEdgeMode("all")}>ALL</button>
            </div>
            <button type="button" disabled={busy} onClick={() => snapshot?.actions?.refresh && void run(snapshot.actions.refresh)}>SYNC</button>
            <button type="button" className="danger" disabled={busy || nodes.length === 0} onClick={() => snapshot?.actions?.clear && window.confirm("Clear every graph memory? This cannot be undone.") && void run(snapshot.actions.clear)}>CLEAR</button>
          </header>

          <div className="graph-context-bar">
            <GraphStatus
              shownNodes={visibleNodeCount}
              shownEdges={visibleEdgeCount}
              totalNodes={snapshot?.totalNodes ?? nodes.length}
              totalEdges={snapshot?.totalEdges ?? edges.length}
              nodeLimit={snapshot?.nodeLimit ?? nodes.length}
            />
            <p><span className="graph-live-dot" />LAYOUT {busy ? "SYNCING" : "READY"}</p>
          </div>

          <div className="graph-stage relative">
            {renderMode === "3d" ? (
              <GraphExplorer3D nodes={nodes} edges={edges} query={query} hiddenTypes={hiddenTypes} edgeMode={edgeMode} selectedId={selectedId} onSelect={setSelectedId} />
            ) : (
              <GraphExplorer nodes={nodes} edges={edges} query={query} hiddenTypes={hiddenTypes} edgeMode={edgeMode} selectedId={selectedId} onSelect={setSelectedId} />
            )}

            <aside className="graph-type-panel">
              <div className="graph-type-head">
                <span>NODE TYPES</span>
                <button type="button" onClick={() => setHiddenTypes([])}>RESET</button>
              </div>
              <div className="graph-type-list">
                {typeCounts.map(([type, count]) => {
                  const hidden = hiddenTypes.includes(type);
                  return <button key={type} type="button" className={hidden ? "disabled" : ""} onClick={() => toggleType(type)}><span className={`graph-type-dot type-${safeClass(type)}`} /><span>{type}</span><code>{count}</code></button>;
                })}
              </div>
            </aside>

            {!snapshot?.available ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div className="border bg-background/95 p-6 backdrop-blur">
                  <p className="font-mono text-xs">GRAPH_STORE_NOT_INITIALIZED</p>
                  <p className="mt-2 text-xs text-muted-foreground">Start the agent once to create the SQLite graph tables.</p>
                </div>
              </div>
            ) : null}

            <NodeDetails
              node={selected}
              connectionCount={connectionCount}
              onClose={() => setSelectedId(undefined)}
              onForget={snapshot?.actions?.forget ? (id) => void run(() => snapshot.actions!.forget(id)).then(() => setSelectedId(undefined)) : undefined}
            />
          </div>

          <footer className="graph-footer">
            <span>RENDERER <b>{renderMode === "3d" ? "THREE.JS / WEBGL" : "SIGMA / WEBGL"}</b></span>
            <span>LAYOUT <b>{renderMode === "3d" ? "D3-FORCE-3D" : "FORCEATLAS2"}</b></span>
            <span>EDGE MODE <b>{edgeMode.toUpperCase()}</b></span>
            <span className="ml-auto">SELECT A NODE TO TRACE ITS LOCAL SUBGRAPH</span>
          </footer>
        </div>
      </section>
    </MicrofrontendFrame>
  );
}

function GraphMetric({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return <div className="graph-metric"><p>{label}</p><strong className={live ? "live" : ""}>{value}</strong></div>;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: value > 9999 ? "compact" : "standard" }).format(value);
}

function safeClass(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

interface MemoryGraphArgs { focus: string; depth?: number }

/** OpenUI component for chat answers: the node for a person or topic with its linked memories, click to explore. */
const MemoryGraphPreview = memo(function MemoryGraphPreview({ component, data, args }: MicrofrontendProps<GraphData> & { args: MemoryGraphArgs }) {
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const [centerId, setCenterId] = useState<string>();
  const match = useMemo(() => bestMatch(nodes, args.focus), [nodes, args.focus]);
  const center = nodes.find((node) => node.id === (centerId ?? match?.id));
  const depth = Math.min(2, Math.max(1, Math.round(args.depth ?? 1)));
  const local = useMemo(() => neighborhood(nodes, edges, center?.id, depth), [nodes, edges, center?.id, depth]);
  const onSelect = useCallback((id?: string) => { if (id) setCenterId(id); }, []);
  if (!data) return <p className="graph-preview-empty">Loading memory…</p>;
  if (!center) return <p className="graph-preview-empty">Nothing in memory about “{args.focus}”.</p>;
  const linked = local.nodes.filter((node) => node.id !== center.id).sort((a, b) => b.weight - a.weight);
  return <div className="graph-preview-wide"><div className="graph-preview rise-in">
    <div className="graph-preview-canvas">
      <GraphExplorer3D nodes={local.nodes} edges={local.edges} query="" hiddenTypes={[]} edgeMode="all" selectedId={center.id} onSelect={onSelect} />
    </div>
    <aside className="graph-preview-side">
      <p className="graph-preview-type">{center.type}</p>
      <h4>{center.label}</h4>
      <p className="graph-preview-meta">{linked.length} linked · weight {center.weight.toFixed(2)}</p>
      <ul>
        {linked.slice(0, 8).map((node, index) => <li key={node.id} className="rise-in" style={{ animationDelay: `${index * 50}ms` }}>
          <button type="button" onClick={() => setCenterId(node.id)} title={node.label}><span className="graph-preview-dot" data-type={node.type} aria-hidden="true" />{node.label}</button>
        </li>)}
      </ul>
      <button type="button" className="graph-preview-open" onClick={() => { location.hash = `component/${encodeURIComponent(component.instanceId)}?node=${encodeURIComponent(center.id)}`; }}>Open in graph</button>
    </aside>
  </div></div>;
});

export const openui = [{ ...MEMORY_GRAPH_OPENUI, component: MemoryGraphPreview }];
