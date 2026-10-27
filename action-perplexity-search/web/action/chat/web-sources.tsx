import type { MicrofrontendProps } from "@agent-os/microfrontend";
import { useCallback, useEffect, useState, type ReactNode, type UIEvent } from "react";

import type { StoredSearch } from "../../../src/search-store.js";

export interface SearchBridge { queries?: { search(id: string): Promise<StoredSearch | null> } }

type Load = { state: "loading" } | { state: "ready"; search: StoredSearch } | { state: "missing" } | { state: "error"; message: string };

/** The sources of one search as a sideways row of cards; the model passes only the search id. */
export function WebSources({ data, args }: MicrofrontendProps<SearchBridge> & { args: { searchId?: string } }) {
  const load = useStoredSearch(args.searchId, data?.queries?.search);
  if (load.state === "loading") return <SourcesSkeleton />;
  if (load.state === "missing") return <p className="ws-note">These search results are no longer stored.</p>;
  if (load.state === "error") return <p className="ws-note">Sources unavailable: {load.message}</p>;
  const { search } = load;
  return <section className="ws-root" aria-label={`Sources for ${search.query}`}>
    <header className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <SearchGlyph />
      <span className="min-w-0 truncate">{search.query}</span>
      <span className="shrink-0">· {search.results.length} {search.results.length === 1 ? "source" : "sources"}</span>
    </header>
    <SourceRow>
      {search.results.map((result, index) => <SourceCard key={result.url} result={result} index={index} />)}
    </SourceRow>
  </section>;
}

/** Scrolls sideways; `has-before` / `has-after` fade the edges that still hide cards. */
function SourceRow({ children }: { children: ReactNode }) {
  const [edges, setEdges] = useState({ before: false, after: false });
  const measure = useCallback((row: HTMLElement | null) => {
    if (!row) return;
    const before = row.scrollLeft > 4;
    const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 4;
    setEdges((previous) => previous.before === before && previous.after === after ? previous : { before, after });
  }, []);
  return <ol
    ref={measure}
    onScroll={(event: UIEvent<HTMLOListElement>) => measure(event.currentTarget)}
    className={`ws-row${edges.before ? " has-before" : ""}${edges.after ? " has-after" : ""}`}
  >{children}</ol>;
}

function SourceCard({ result, index }: { result: StoredSearch["results"][number]; index: number }) {
  const host = hostOf(result.url);
  return <li className="ws-card" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
    <a href={result.url} target="_blank" rel="noreferrer noopener" className="flex h-full flex-col gap-2 p-3.5">
      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Favicon host={host} />
        <span className="min-w-0 flex-1 truncate">{host}</span>
        <span className="ws-index">{index + 1}</span>
      </span>
      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{result.title}</span>
      <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{result.snippet}</span>
      {result.date ? <span className="mt-auto pt-1 text-[11px] text-muted-foreground">{formatDate(result.date)}</span> : null}
    </a>
  </li>;
}

/** The site's own icon, or its first letter when it has none. */
function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !host) return <span className="ws-favicon">{host.charAt(0).toUpperCase() || "?"}</span>;
  return <img src={`https://${host}/favicon.ico`} alt="" width={16} height={16} loading="lazy" className="ws-favicon" onError={() => setFailed(true)} />;
}

function SourcesSkeleton() {
  return <ol className="ws-row" aria-label="Loading sources">
    {[0, 1, 2].map((index) => <li key={index} className="ws-card ws-skeleton" />)}
  </ol>;
}

function SearchGlyph() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function useStoredSearch(searchId: string | undefined, search: ((id: string) => Promise<StoredSearch | null>) | undefined): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const ready = Boolean(search);
  useEffect(() => {
    if (!searchId) return setLoad({ state: "missing" });
    if (!search) return;
    let alive = true;
    search(searchId).then(
      (found) => { if (alive) setLoad(found ? { state: "ready", search: found } : { state: "missing" }); },
      (error: unknown) => { if (alive) setLoad({ state: "error", message: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { alive = false; };
    // The bridge recreates `search` on every data refresh; one load per id is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchId, ready]);
  return load;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
