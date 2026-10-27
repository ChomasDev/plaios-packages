"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  ConfigurationEditor,
  InstanceSummary,
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@agent-os/microfrontend";

import type {
  GodsEyeViewCommandEnvelope,
  GodsEyeViewDashboard,
  GodsEyeViewLayer,
  GodsEyeViewOutput,
} from "../../src/index.js";

const QUICK_LAYERS: Array<{ value: GodsEyeViewLayer; label: string }> = [
  { value: "cameras", label: "Cameras" },
  { value: "flights", label: "Flights" },
  { value: "vessels", label: "Vessels" },
  { value: "satellites", label: "Satellites" },
  { value: "traffic", label: "Traffic" },
  { value: "all", label: "All signals" },
];

const MESSAGE_TYPE = "agent-os:gods-eye-view";

export default function GodsEyeViewAction({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<GodsEyeViewDashboard>) {
  const [prompt, setPrompt] = useState("Show me all the cameras at Treviso");
  const [activeView, setActiveView] = useState<GodsEyeViewOutput | null>(
    data?.lastView ?? null,
  );
  const [frameUrl, setFrameUrl] = useState(() =>
    embeddedUrl(data?.lastView?.url ?? data?.baseUrl),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(data?.serverError ?? "");
  const [bridgeStatus, setBridgeStatus] = useState<
    "loading" | "ready" | "working" | "error"
  >("loading");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastSequence = useRef(data?.lastView?.commandSequence ?? 0);
  const pending = useRef<GodsEyeViewCommandEnvelope[]>([]);

  const frameOrigin = useMemo(() => {
    try {
      return new URL(frameUrl).origin;
    } catch {
      return "*";
    }
  }, [frameUrl]);

  useEffect(() => {
    setActiveView(data?.lastView ?? null);
    setError(data?.serverError ?? "");
  }, [data?.lastView, data?.serverError]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== frameOrigin || event.data?.type !== MESSAGE_TYPE)
        return;
      if (
        event.data.kind === "prompt" &&
        typeof event.data.prompt === "string"
      ) {
        void ask(event.data.prompt);
        return;
      }
      setBridgeStatus(event.data.ok ? "ready" : "error");
      if (!event.data.ok)
        setError(String(event.data.error || "The globe command failed."));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameOrigin]);

  useEffect(() => {
    if (!data?.actions.sync) return;
    let stopped = false;
    const poll = async () => {
      try {
        const update = await data.actions.sync(lastSequence.current);
        if (stopped) return;
        if (update.serverError) setError(update.serverError);
        if (update.lastView) setActiveView(update.lastView);
        if (update.commands.length) {
          pending.current.push(...update.commands);
          lastSequence.current = Math.max(
            ...update.commands.map((item) => item.sequence),
          );
          const latestUrl = embeddedUrl(update.commands.at(-1)?.url);
          if (latestUrl && latestUrl !== frameUrl) {
            setBridgeStatus("loading");
            setFrameUrl(latestUrl);
          } else {
            flushCommands();
          }
        }
      } catch (reason) {
        if (!stopped)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_200);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [data?.actions, frameUrl]);

  function flushCommands(): void {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || pending.current.length === 0) return;
    setBridgeStatus("working");
    for (const envelope of pending.current.splice(0)) {
      frame.postMessage(
        {
          type: MESSAGE_TYPE,
          requestId: String(envelope.sequence),
          commands: envelope.commands,
        },
        frameOrigin,
      );
    }
  }

  async function ask(
    query = prompt,
    layer: GodsEyeViewLayer | null = null,
  ): Promise<void> {
    if (!data?.actions.open || !query.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await data.actions.open({
        query: query.trim(),
        location: null,
        layer,
        deviceId: null,
        openOnMac: false,
      });
      setActiveView(result);
      setFrameUrl(embeddedUrl(result.url));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MicrofrontendFrame
      component={component}
      title="God's Eye View"
      description="The complete live intelligence globe, bundled locally and controllable by Agent OS."
    >
      <div className="gev-shell">
        <section className="gev-console" aria-label="God's Eye View console">
          <header className="gev-command-bar">
            <div className="gev-identity">
              <span className="gev-orbit-mark" aria-hidden="true">
                <i />
              </span>
              <div>
                <p>OCCHIO DI DIO</p>
                <h2>{activeView?.location ?? "Live Earth"}</h2>
              </div>
            </div>

            <form
              className="gev-ai-form"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <span className="gev-ai-spark" aria-hidden="true">
                ✦
              </span>
              <input
                aria-label="Ask God's Eye View"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask: show military flights over Venice…"
              />
              <button type="submit" disabled={busy}>
                {busy ? "Working…" : "Run"}
              </button>
            </form>

            <button
              className="gev-open-button"
              type="button"
              onClick={() =>
                window.open(frameUrl, "_blank", "noopener,noreferrer")
              }
            >
              Open on Mac
            </button>
          </header>

          <nav className="gev-quick-rail" aria-label="Quick signal layers">
            {QUICK_LAYERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() =>
                  void ask(
                    `Show ${item.label.toLowerCase()}${activeView?.location ? ` at ${activeView.location}` : ""}`,
                    item.value,
                  )
                }
              >
                {item.label}
              </button>
            ))}
            <span className="gev-rail-spacer" />
            <Badge variant={data?.mapboxReady ? "success" : "outline"}>
              {data?.mapboxReady ? "Mapbox ready" : "Mapbox optional"}
            </Badge>
          </nav>

          {error ? (
            <div className="gev-notice gev-error" role="alert">
              {error}
            </div>
          ) : null}
          {activeView?.coverageNotice ? (
            <div className="gev-notice" role="status">
              {activeView.coverageNotice}
            </div>
          ) : null}

          <div className="gev-webview-wrap">
            <iframe
              ref={iframeRef}
              key={frameUrl}
              className="gev-webview"
              src={frameUrl}
              title="God's Eye View live globe"
              allow="microphone; camera; geolocation; clipboard-write; fullscreen"
              onLoad={() => {
                setBridgeStatus("ready");
                flushCommands();
              }}
            />
          </div>

          <footer className="gev-status-strip">
            <span
              className={`gev-live-dot gev-state-${bridgeStatus}`}
              aria-hidden="true"
            />
            <span>{bridgeLabel(bridgeStatus)}</span>
            <span className="gev-status-separator" />
            <span>
              {activeView?.layer
                ? `${activeView.layer} active`
                : "Globe online"}
            </span>
            {activeView?.coordinates ? (
              <code>
                {activeView.coordinates.latitude.toFixed(4)},{" "}
                {activeView.coordinates.longitude.toFixed(4)}
              </code>
            ) : null}
            <span className="gev-status-spacer" />
            <span>Upstream MIT · Bilawal Sidhu</span>
          </footer>
        </section>

        <details className="gev-settings">
          <summary>Action settings and connection details</summary>
          <div className="gev-settings-grid">
            <div className="gev-settings-copy">
              <p>
                The complete upstream source, live-feed middleware, voice tools,
                scenes, and assets are vendored inside this action.
              </p>
              <p>
                The phrase{" "}
                <strong>“{data?.protocolTrigger ?? "occhio di dio"}”</strong> is
                stored as procedural memory.
              </p>
              <a href={data?.repositoryUrl} target="_blank" rel="noreferrer">
                Original repository and data-source notes
              </a>
            </div>
            <ConfigurationEditor
              component={component}
              onSaveConfig={onSaveConfig}
            />
            <InstanceSummary component={component} />
          </div>
        </details>
      </div>
    </MicrofrontendFrame>
  );
}

function embeddedUrl(value?: string): string {
  if (!value) return "http://localhost:4173/?agent_os=1";
  try {
    const url = new URL(value);
    url.searchParams.set("agent_os", "1");
    return url.href;
  } catch {
    return value;
  }
}

function bridgeLabel(
  status: "loading" | "ready" | "working" | "error",
): string {
  if (status === "loading") return "Loading local globe";
  if (status === "working") return "Executing AI command";
  if (status === "error") return "Bridge needs attention";
  return "AI bridge connected";
}
