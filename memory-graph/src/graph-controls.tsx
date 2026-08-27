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
      <span className="text-xs text-muted-foreground">
        {limited
          ? `Showing the ${nodeLimit} most recent nodes`
          : "Showing every stored node"}
      </span>
    </div>
  );
}

export function NodeDetails({ node, onForget }: { node?: GraphNodeDto; onForget?: (id: string) => void }) {
  if (!node) return null;
  return (
    <div className="absolute bottom-4 left-4 right-4 z-10 max-w-md rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur md:right-auto md:w-96">
      <div className="flex justify-between gap-3">
        <div>
          <p className="font-medium">{node.label}</p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
            {node.id}
          </p>
        </div>
        <Tag>{node.type}</Tag>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <Field label="Kind" value={node.kind ?? "—"} />
        <Field label="Weight" value={node.weight.toFixed(2)} />
        <Field
          label="addedMemoryDate"
          value={formatDate(node.addedMemoryDate ?? node.createdAt)}
        />
        <Field label="factDate" value={formatDate(node.factDate)} />
        <div className="col-span-2">
          <Field label="Session" value={node.sessionId ?? "global"} />
        </div>
      </div>
      {onForget ? (
        <button
          type="button"
          onClick={() => onForget(node.id)}
          className="mt-4 h-8 border border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          Forget node
        </button>
      ) : null}
    </div>
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
      className="grid size-9 place-items-center rounded-md border bg-background/90 text-sm shadow-sm backdrop-blur hover:bg-muted"
    >
      {children}
    </button>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
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

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
