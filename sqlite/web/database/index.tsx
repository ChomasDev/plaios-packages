"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfigurationEditor,
  Input,
  InstanceSummary,
  MicrofrontendFrame,
  Textarea,
  type MicrofrontendProps,
} from "@plaios/microfrontend";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  SQLiteAdminClient,
  SQLitePage,
  SQLiteQueryResult,
  SQLiteTableDetails,
  SQLiteTableSummary,
} from "../../src/admin.js";

export interface SQLiteMicrofrontendData {
  admin?: SQLiteAdminClient;
  databasePath?: string;
}

const PAGE_SIZE = 50;
const DEFAULT_QUERY = "SELECT name, type\nFROM sqlite_schema\nORDER BY type, name;";

export default function SQLiteDatabaseMicrofrontend({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<SQLiteMicrofrontendData>) {
  const admin = data?.admin;
  const [tables, setTables] = useState<readonly SQLiteTableSummary[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [details, setDetails] = useState<SQLiteTableDetails>();
  const [page, setPage] = useState<SQLitePage>();
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<"rows" | "schema">("rows");
  const [sql, setSql] = useState(DEFAULT_QUERY);
  const [queryResult, setQueryResult] = useState<SQLiteQueryResult>();
  const [confirmWrites, setConfirmWrites] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refreshTables = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    setError(undefined);
    try {
      const nextTables = await admin.listTables();
      setTables(nextTables);
      setSelectedTable((current) =>
        nextTables.some((table) => table.name === current)
          ? current
          : (nextTables[0]?.name ?? ""),
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  const refreshTable = useCallback(async () => {
    if (!admin || !selectedTable) {
      setDetails(undefined);
      setPage(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const [nextDetails, nextPage] = await Promise.all([
        admin.describeTable(selectedTable),
        admin.browseTable(selectedTable, { offset, limit: PAGE_SIZE }),
      ]);
      setDetails(nextDetails);
      setPage(nextPage);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [admin, offset, selectedTable]);

  useEffect(() => {
    void refreshTables();
  }, [refreshTables]);

  useEffect(() => {
    void refreshTable();
  }, [refreshTable]);

  const totalRows = useMemo(
    () => tables.reduce((sum, table) => sum + table.rowCount, 0),
    [tables],
  );
  const queryCanWrite = !isReadOnlySql(sql);

  async function runQuery() {
    if (!admin) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await admin.execute(sql, {
        allowWrite: queryCanWrite && confirmWrites,
        maxRows: 250,
      });
      setQueryResult(result);
      if (result.kind === "changes") {
        await refreshTables();
        await refreshTable();
        setConfirmWrites(false);
      }
    } catch (cause) {
      setQueryResult(undefined);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <MicrofrontendFrame
      component={component}
      title="SQLite database"
      description="Browse capability data, inspect schemas, and run SQL against this SQLite instance."
    >
      <div className="agentos-sqlite-console space-y-5">
      <div className="grid gap-px border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Connection" value={admin ? "Online" : "No bridge"} />
        <Metric label="Tables" value={String(tables.length).padStart(2, "0")} />
        <Metric label="Total rows" value={String(totalRows)} />
        <Metric
          label="Database"
          value={data?.databasePath ?? String(component.config.databasePath ?? "Default path")}
          truncate
        />
      </div>

      {!admin ? (
        <Card className="rounded-none border-destructive/30 bg-destructive/5">
          <CardHeader className="border-b">
            <CardTitle className="text-destructive">Admin bridge unavailable</CardTitle>
            <CardDescription>
              Pass <code className="font-mono text-foreground">provider.microfrontendData()</code> as this surface&apos;s data to enable live management.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 pt-4 lg:grid-cols-2">
            <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
            <InstanceSummary component={component} />
          </CardContent>
        </Card>
      ) : (
        <>
          {error ? (
            <div className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
              {error}
            </div>
          ) : null}

          <div className="grid min-w-0 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <Card className="min-w-0 rounded-none lg:self-start">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Eyebrow>Database index</Eyebrow>
                    <CardTitle className="mt-1">Tables</CardTitle>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-none"
                    disabled={loading}
                    onClick={() => void refreshTables()}
                  >
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {tables.length === 0 ? (
                  <EmptyState>No user tables yet.</EmptyState>
                ) : (
                  <div className="divide-y">
                    {tables.map((table) => (
                      <button
                        key={table.name}
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 ${selectedTable === table.name ? "bg-muted/50" : ""}`}
                        onClick={() => {
                          setSelectedTable(table.name);
                          setOffset(0);
                        }}
                      >
                        <span className={`size-1.5 shrink-0 ${selectedTable === table.name ? "bg-destructive" : "bg-muted-foreground/40"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs font-medium">{table.localName}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">{table.namespace ?? "global"}</span>
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">{table.rowCount}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-none">
              <CardHeader className="border-b">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Eyebrow>Selected table</Eyebrow>
                    <CardTitle className="mt-1 truncate font-mono">{selectedTable || "No table selected"}</CardTitle>
                  </div>
                  <div className="flex bg-muted p-[3px]">
                    <ViewButton active={view === "rows"} onClick={() => setView("rows")}>Rows</ViewButton>
                    <ViewButton active={view === "schema"} onClick={() => setView("schema")}>Schema</ViewButton>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedTable ? (
                  <EmptyState>Select a table to inspect it.</EmptyState>
                ) : view === "rows" ? (
                  <RowBrowser page={page} loading={loading} />
                ) : (
                  <SchemaBrowser details={details} loading={loading} />
                )}
              </CardContent>
              {view === "rows" && page ? (
                <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {page.total === 0 ? "0 rows" : `${page.offset + 1}–${Math.min(page.offset + page.rows.length, page.total)} of ${page.total}`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-none"
                      disabled={loading || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-none"
                      disabled={loading || offset + PAGE_SIZE >= page.total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>

          <Card className="min-w-0 rounded-none">
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <Eyebrow>SQL workspace</Eyebrow>
                  <CardTitle className="mt-1">Query console</CardTitle>
                  <CardDescription className="mt-1">
                    Read queries run immediately. Writes require explicit confirmation each time.
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={`rounded-none ${queryCanWrite ? "border-destructive/30 bg-destructive/5 text-destructive" : ""}`}
                >
                  {queryCanWrite ? "Can modify data" : "Read only"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <Textarea
                value={sql}
                onChange={(event) => {
                  setSql(event.target.value);
                  setConfirmWrites(false);
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void runQuery();
                  }
                }}
                spellCheck={false}
                className="min-h-36 resize-y rounded-none font-mono text-xs leading-6"
                aria-label="SQL query"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className={`flex items-center gap-2 text-xs ${queryCanWrite ? "text-destructive" : "text-muted-foreground"}`}>
                  <input
                    type="checkbox"
                    checked={confirmWrites}
                    disabled={!queryCanWrite}
                    onChange={(event) => setConfirmWrites(event.target.checked)}
                    className="size-3.5 accent-current"
                  />
                  I understand this statement may change the database
                </label>
                <Button
                  className="rounded-none"
                  disabled={loading || !sql.trim() || (queryCanWrite && !confirmWrites)}
                  onClick={() => void runQuery()}
                >
                  {loading ? "Running…" : "Run query"}
                  <span className="ml-2 font-mono text-[9px] opacity-65">⌘↵</span>
                </Button>
              </div>
              {queryResult ? <QueryResults result={queryResult} /> : null}
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
            <InstanceSummary component={component} />
          </div>
        </>
      )}
      </div>
    </MicrofrontendFrame>
  );
}

function Metric({ label, value, truncate = false }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="min-w-0 bg-background p-4">
      <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-5 font-mono text-sm font-medium ${truncate ? "truncate" : ""}`} title={truncate ? value : undefined}>{value}</p>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{children}</p>;
}

function ViewButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 px-3 text-xs font-medium transition-colors ${active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function RowBrowser({ page, loading }: { page?: SQLitePage; loading: boolean }) {
  if (!page || loading) return <LoadingState />;
  if (page.rows.length === 0) return <EmptyState>This table has no rows.</EmptyState>;
  return <DataTable columns={page.columns} rows={page.rows} />;
}

function SchemaBrowser({ details, loading }: { details?: SQLiteTableDetails; loading: boolean }) {
  if (!details || loading) return <LoadingState />;
  return (
    <div className="space-y-5 p-4">
      <div className="overflow-x-auto border">
        <table className="w-full min-w-[36rem] border-collapse text-left text-xs">
          <thead className="bg-muted/40 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              {['Column', 'Type', 'Nullable', 'Default', 'Key'].map((label) => <th key={label} className="border-b px-3 py-2 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            {details.columns.map((column) => (
              <tr key={column.name} className="hover:bg-muted/20">
                <td className="px-3 py-2 font-mono font-medium">{column.name}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{column.type || 'ANY'}</td>
                <td className="px-3 py-2">{column.nullable ? 'Yes' : 'No'}</td>
                <td className="max-w-48 truncate px-3 py-2 font-mono text-muted-foreground">{column.defaultValue ?? '—'}</td>
                <td className="px-3 py-2">{column.primaryKeyPosition ? `PK ${column.primaryKeyPosition}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Eyebrow>Indexes</Eyebrow>
        <div className="mt-2 divide-y border">
          {details.indexes.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">No indexes.</p>
          ) : details.indexes.map((index) => (
            <div key={index.name} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
              <code>{index.name}</code>
              <span className="text-muted-foreground">{index.unique ? 'Unique' : 'Index'} · {index.columns.join(', ')}</span>
            </div>
          ))}
        </div>
      </div>
      {details.createSql ? (
        <div>
          <Eyebrow>Definition</Eyebrow>
          <pre className="mt-2 overflow-x-auto border bg-muted/25 p-3 font-mono text-[11px] leading-5"><code>{details.createSql}</code></pre>
        </div>
      ) : null}
    </div>
  );
}

function QueryResults({ result }: { result: SQLiteQueryResult }) {
  return (
    <div className="border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{result.kind === "rows" ? `${result.rows.length} rows returned` : `${result.changes} rows changed`}</span>
        <span className="font-mono normal-case tracking-normal">{result.durationMs.toFixed(2)} ms</span>
      </div>
      {result.kind === "rows" ? (
        result.rows.length ? <DataTable columns={result.columns} rows={result.rows} /> : <EmptyState>Query completed with no rows.</EmptyState>
      ) : (
        <div className="grid gap-px bg-border sm:grid-cols-2">
          <Metric label="Changes" value={String(result.changes)} />
          <Metric label="Last insert rowid" value={String(result.lastInsertRowid ?? '—')} />
        </div>
      )}
    </div>
  );
}

function DataTable({ columns, rows }: { columns: readonly string[]; rows: readonly Record<string, unknown>[] }) {
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-background text-[9px] uppercase tracking-[0.14em] text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>{columns.map((column) => <th key={column} className="max-w-72 px-3 py-2 font-medium">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-muted/20">
              {columns.map((column) => (
                <td key={column} className="max-w-72 truncate px-3 py-2 font-mono text-[11px]" title={formatValue(row[column])}>
                  <Cell value={row[column]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-muted-foreground">NULL</span>;
  if (value === undefined) return <span className="text-muted-foreground">—</span>;
  return <>{formatValue(value)}</>;
}

function LoadingState() {
  return <div className="grid min-h-52 place-items-center text-xs uppercase tracking-[0.16em] text-muted-foreground">Loading data…</div>;
}

function EmptyState({ children }: { children: string }) {
  return <div className="grid min-h-40 place-items-center p-8 text-center text-xs text-muted-foreground">{children}</div>;
}

function formatValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (value instanceof Uint8Array) return `[BLOB ${value.byteLength} bytes]`;
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "").trim();
  const keyword = /^[A-Za-z]+/.exec(normalized)?.[0]?.toUpperCase();
  return keyword === "SELECT" || keyword === "PRAGMA" || keyword === "EXPLAIN";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
