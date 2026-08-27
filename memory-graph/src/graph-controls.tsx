import type { GraphNodeDto } from "./graph-view-model.js";

export function GraphStatus({
  shownNodes,
  shownEdges,
  totalNodes,
  totalEdges,
  nodeLimit,
}: {
  shownNodes: number;
  shownEdges: number;
  totalNodes: number;
  totalEdges: number;
  nodeLimit: number;
}) {
  const limited = shownNodes < totalNodes;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tag>
        {shownNodes} / {totalNodes} nodes
      </Tag>
      <Tag>
        {shownEdges} / {totalEdges} edges
      </Tag>
      <span className="font-mono text-[9px] uppercase tracking-[.08em] text-muted-foreground">
        {limited
          ? `Showing the ${nodeLimit} most recent nodes`
          : "Showing every stored node"}
      </span>
    </div>
  );
}

export function NodeDetails({ node, connectionCount = 0, onClose, onForget }: { node?: GraphNodeDto; connectionCount?: number; onClose?: () => void; onForget?: (id: string) => void }) {
  if (!node) return null;
  return (
    <aside className="graph-inspector absolute bottom-3 right-3 top-3 z-20 w-[min(23rem,calc(100%-1.5rem))] border bg-background/95 shadow-2xl backdrop-blur-xl">
      <div className="graph-inspector-head flex justify-between gap-3 border-b p-4">
        <div>
          <p className="text-[9px] uppercase tracking-[.16em] text-muted-foreground">Node inspector</p>
          <p className="mt-2 font-medium leading-5">{node.label}</p>
        </div>
        <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center border text-xs text-muted-foreground hover:bg-muted">×</button>
      </div>
      <div className="border-b p-4"><p className="break-all font-mono text-[10px] leading-5 text-muted-foreground">{node.id}</p></div>
      <div className="grid grid-cols-2 gap-px border-b bg-border text-xs">
        <InspectorMetric label="Type" value={node.type} />
        <InspectorMetric label="Connections" value={String(connectionCount)} />
        <InspectorMetric label="Kind" value={node.kind ?? "—"} />
        <InspectorMetric label="Weight" value={node.weight.toFixed(3)} />
      </div>
      <div className="grid gap-4 p-4 text-xs">
        <Field
          label="Added memory date"
          value={formatDate(node.addedMemoryDate ?? node.createdAt)}
        />
        <Field label="Fact date" value={formatDate(node.factDate)} />
        <Field label="Session" value={node.sessionId ?? "global"} />
        <Field label="User" value={node.userId ?? "global"} />
      </div>
      {onForget ? (
        <button
          type="button"
          onClick={() => onForget(node.id)}
          className="mx-4 mb-4 h-9 border border-destructive/40 px-3 font-mono text-[10px] font-medium uppercase tracking-[.1em] text-destructive hover:bg-destructive/10"
        >
          Forget node
        </button>
      ) : null}
    </aside>
  );
}

export function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center border bg-background/90 font-mono text-xs shadow-sm backdrop-blur hover:bg-muted"
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="border bg-muted px-2 py-1 font-mono text-[9px] font-medium uppercase tracking-[.06em] text-muted-foreground">
      {children}
    </span>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono">{value}</p>
    </div>
  );
}

function InspectorMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-background p-3"><p className="text-[8px] uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-2 truncate font-mono text-xs">{value}</p></div>;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
