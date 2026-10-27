"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfigurationEditor,
  InstanceSummary,
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@plaios/microfrontend";

interface ApiData {
  listening?: boolean;
  address?: { address: string; family: string; port: number } | string | null;
  hostname?: string;
  configuredPort?: number;
  authRequired?: boolean;
  openClawCompatibility?: boolean;
  models?: string[];
  endpoints?: string[];
  transports?: string[];
}

export default function OpenRouterApiMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<ApiData>) {
  const port = typeof data?.address === "object" && data.address ? data.address.port : data?.configuredPort;
  return (
    <MicrofrontendFrame
      component={component}
      title="OpenAI-compatible API"
      description="Manage the correlated HTTP input/output adapter, streaming responses, and OpenClaw WebSocket compatibility."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.6fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle>Gateway status</CardTitle><CardDescription>The input and output interfaces share one correlated server instance.</CardDescription></div>
                <Badge variant={data?.listening ? "default" : "secondary"}>{data?.listening ? "Listening" : "Waiting"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Address" value={`${data?.hostname ?? "127.0.0.1"}:${port ?? "—"}`} />
              <Metric label="Authentication" value={data?.authRequired ? "Bearer token" : "Open"} />
              <Metric label="OpenClaw" value={data?.openClawCompatibility ? "Protocol v4" : "Disabled"} />
              <Metric label="Transports" value={(data?.transports ?? []).join(" · ") || "HTTP"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Advertised models</CardTitle><CardDescription>Models returned by discovery endpoints.</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2">{(data?.models ?? []).map((model) => <Badge key={model} variant="outline">{model}</Badge>)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Endpoints</CardTitle><CardDescription>Compatible HTTP resources mounted by this capability.</CardDescription></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">{(data?.endpoints ?? []).map((endpoint) => <code key={endpoint} className="border bg-muted/30 px-3 py-2 text-xs">{endpoint}</code>)}</CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
          <InstanceSummary component={component} />
        </div>
      </div>
    </MicrofrontendFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xs">{value}</p></div>;
}
