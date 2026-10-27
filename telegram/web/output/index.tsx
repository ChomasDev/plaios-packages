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

import type { TelegramOutputData } from "../types.js";

export default function TelegramOutputMicrofrontend({
  component,
  data,
  onSaveConfig,
}: MicrofrontendProps<TelegramOutputData>) {
  const deliveries = data?.deliveries ?? [];

  return (
    <MicrofrontendFrame
      component={component}
      title="Telegram output"
      description="Manage response delivery and inspect recent messages sent through Telegram."
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
                <CardTitle>Delivery status</CardTitle>
                <Badge variant={data?.available ? "success" : "outline"}>
                  {data?.available ? "Available" : "Unavailable"}
                </Badge>
              </div>
              <CardDescription>
                Bot API availability for this output instance.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Recent deliveries</span>
                <span className="font-mono text-xs">{deliveries.length}</span>
              </div>
            </CardContent>
          </Card>
          <InstanceSummary component={component} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent output</CardTitle>
          <CardDescription>
            Delivery records supplied by the host for this interface instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deliveries.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No Telegram deliveries have been recorded yet.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {deliveries.map((delivery) => (
                <article key={delivery.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="text-xs font-semibold">
                      {delivery.chatId}
                    </code>
                    <Badge variant={statusVariant(delivery.status)}>
                      {delivery.status}
                    </Badge>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6">
                    {delivery.preview}
                  </p>
                  <time className="block text-xs text-muted-foreground">
                    {delivery.createdAt}
                  </time>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </MicrofrontendFrame>
  );
}

function statusVariant(
  status: "queued" | "sent" | "failed",
): "secondary" | "success" | "outline" {
  if (status === "sent") return "success";
  if (status === "queued") return "secondary";
  return "outline";
}
