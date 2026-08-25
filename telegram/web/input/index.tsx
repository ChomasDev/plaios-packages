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
} from "@agent-os/microfrontend";

import type { TelegramInputData } from "../types.js";

export default function TelegramInputMicrofrontend({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<TelegramInputData>) {
  const messages = data?.messages ?? [];

  return (
    <MicrofrontendFrame
      component={component}
      title="Telegram input"
      description="Manage Bot API polling and inspect messages received by this Telegram input."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ConfigurationEditor
          component={component}
          onSaveConfig={onSaveConfig}
        />
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Polling status</CardTitle>
                <Badge variant={data?.connected ? "success" : "outline"}>
                  {data?.connected ? "Connected" : "Unavailable"}
                </Badge>
              </div>
              <CardDescription>
                Long-polling health for the configured bot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Metric label="Messages" value={String(messages.length)} />
              <Metric
                label="Last poll"
                value={data?.lastPolledAt ?? "No polling data"}
              />
            </CardContent>
          </Card>
          <InstanceSummary component={component} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent input</CardTitle>
          <CardDescription>
            Messages supplied by the host for this interface instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <EmptyState>No Telegram messages have been recorded yet.</EmptyState>
          ) : (
            <div className="divide-y rounded-lg border">
              {messages.map((message) => (
                <article key={message.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-xs font-semibold">
                      {message.userId ?? "unknown user"}
                    </code>
                    <time className="text-xs text-muted-foreground">
                      {message.createdAt}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {message.content}
                  </p>
                  <code className="block truncate text-[11px] text-muted-foreground">
                    {message.sessionId}
                  </code>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </MicrofrontendFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="grid min-h-48 place-items-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
