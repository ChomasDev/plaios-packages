"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InstanceSummary,
  MicrofrontendFrame,
  type MicrofrontendProps,
} from "@plaios/microfrontend";
import { useEffect, useState } from "react";

interface Prediction {
  id: string;
  key: string;
  description: string;
  actionPrompt: string;
  minuteOfDay: number;
  weekdays: number[];
  timezone: string;
  occurrences: number;
  status: "active" | "dismissed" | "promoted" | "muted";
  ignoredCount: number;
  lastAskedAt?: string;
}

interface PredictorData {
  listening: boolean;
  outputChannel: string;
  predictions: Prediction[];
  actions?: {
    refresh(): Promise<PredictorData>;
    analyze(): Promise<PredictorData>;
    ask(idOrKey: string): Promise<PredictorData>;
    dismiss(idOrKey: string): Promise<PredictorData>;
    resume(idOrKey: string): Promise<PredictorData>;
    remove(idOrKey: string): Promise<PredictorData>;
  };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PatternPredictorSurface({ component, data }: MicrofrontendProps<PredictorData>) {
  const [snapshot, setSnapshot] = useState(data);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => setSnapshot(data), [data]);

  async function run(label: string, operation: () => Promise<PredictorData>) {
    setBusy(label);
    setError(undefined);
    try {
      setSnapshot(await operation());
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy(undefined);
    }
  }

  const actions = snapshot?.actions;
  const predictions = snapshot?.predictions ?? [];
  return (
    <MicrofrontendFrame
      component={component}
      title="Pattern predictor"
      description={`Learns requests you repeat at the same time of day and asks on ${snapshot?.outputChannel ?? "your channel"} a few minutes before.`}
    >
      <div className="grid gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Learned habits</CardTitle>
                <CardDescription>Analysed every night; a habit needs several different days at a similar time.</CardDescription>
              </div>
              <button
                type="button"
                className="border px-3 py-2 font-mono text-xs"
                disabled={!actions || Boolean(busy)}
                onClick={() => actions && void run("analyze", actions.analyze)}
              >
                {busy === "analyze" ? "ANALYSING…" : "ANALYSE NOW"}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
            {predictions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No habits found yet.</p>
            ) : (
              <ul className="divide-y">
                {predictions.map((prediction) => (
                  <li key={prediction.id} className="grid gap-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{prediction.description}</p>
                        <code className="text-xs text-muted-foreground">
                          {prediction.key} · {clock(prediction.minuteOfDay)} · {days(prediction.weekdays)} · {prediction.occurrences} days
                        </code>
                      </div>
                      <Badge variant={prediction.status === "active" ? "success" : "outline"}>{prediction.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last asked {prediction.lastAskedAt ? new Date(prediction.lastAskedAt).toLocaleString() : "never"}
                      {prediction.ignoredCount ? ` · ${prediction.ignoredCount} unanswered` : ""}
                    </p>
                    {actions ? (
                      <div className="flex gap-2 font-mono text-xs">
                        {prediction.status === "active" ? (
                          <>
                            <button type="button" className="border px-2 py-1" disabled={Boolean(busy)} onClick={() => void run(prediction.id, () => actions.ask(prediction.id))}>ASK NOW</button>
                            <button type="button" className="border px-2 py-1" disabled={Boolean(busy)} onClick={() => void run(prediction.id, () => actions.dismiss(prediction.id))}>DISMISS</button>
                          </>
                        ) : (
                          <button type="button" className="border px-2 py-1" disabled={Boolean(busy)} onClick={() => void run(prediction.id, () => actions.resume(prediction.id))}>RESUME</button>
                        )}
                        <button type="button" className="border px-2 py-1 text-destructive" disabled={Boolean(busy)} onClick={() => window.confirm(`Remove ${prediction.key}?`) && void run(prediction.id, () => actions.remove(prediction.id))}>REMOVE</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <InstanceSummary component={component} />
      </div>
    </MicrofrontendFrame>
  );
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function days(weekdays: readonly number[]): string {
  if (weekdays.length === 7) return "every day";
  if (weekdays.join() === "1,2,3,4,5") return "weekdays";
  if (weekdays.join() === "0,6") return "weekends";
  return weekdays.map((day) => DAYS[day]).join(", ");
}
