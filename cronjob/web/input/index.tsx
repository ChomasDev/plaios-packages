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
} from "@agent-os/microfrontend";
import { useEffect, useMemo, useState } from "react";

interface Cronjob {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  timezone: string;
  preferredOutputChannel?: string;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastError?: string;
}

interface CronData {
  channel: string;
  listening: boolean;
  activeCount: number;
  jobs: Cronjob[];
  policy: {
    defaultTimezone: string;
    preferredOutputChannel?: string;
    maxJobs: number;
    allowSeconds: boolean;
  };
  actions?: {
    refresh(): Promise<CronData>;
    add(options: {
      name: string;
      cronExpression: string;
      prompt: string;
      timezone?: string;
      preferredOutputChannel?: string;
    }): Promise<CronData>;
    suspend(idOrName: string): Promise<CronData>;
    resume(idOrName: string): Promise<CronData>;
    remove(idOrName: string): Promise<CronData>;
  };
}

const presets = [
  ["Weekdays 09:00", "0 9 * * 1-5"],
  ["Daily 18:00", "0 18 * * *"],
  ["Monday 08:30", "30 8 * * 1"],
] as const;

export default function CronjobInputSurface({
  component,
  data,
}: MicrofrontendProps<CronData>) {
  const [snapshot, setSnapshot] = useState(data);
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(
    data?.policy.defaultTimezone ?? "Europe/Rome",
  );
  const [output, setOutput] = useState(
    data?.policy.preferredOutputChannel ?? "telegram",
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setSnapshot(data);
    if (data?.policy.defaultTimezone) setTimezone(data.policy.defaultTimezone);
    if (data?.policy.preferredOutputChannel) {
      setOutput(data.policy.preferredOutputChannel);
    }
  }, [data]);

  const jobs = snapshot?.jobs ?? [];
  const suspended = useMemo(
    () => jobs.filter(({ status }) => status === "suspended").length,
    [jobs],
  );

  async function mutate(label: string, operation: () => Promise<CronData>) {
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

  return (
    <MicrofrontendFrame
      component={component}
      title="Cron scheduler"
      description="Persistent scheduled prompts enter the same agent pipeline as Telegram and API messages. Manage them here or through the cronjobs.manage capability."
    >
      <div className="cron-console">
        <section className="cron-metrics">
          <Metric label="Scheduler" value={snapshot?.listening ? "LISTENING" : "STOPPED"} tone={snapshot?.listening ? "live" : "error"} />
          <Metric label="Active jobs" value={String(snapshot?.activeCount ?? 0).padStart(2, "0")} />
          <Metric label="Suspended" value={String(suspended).padStart(2, "0")} />
          <Metric label="Capacity" value={`${jobs.length}/${snapshot?.policy.maxJobs ?? 100}`} />
        </section>

        <div className="cron-grid">
          <Card className="cron-composer">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>New schedule</CardTitle>
                  <CardDescription>Create a recurring agent execution.</CardDescription>
                </div>
                <Badge variant="outline">5-field cron</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="cron-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!snapshot?.actions || !name.trim() || !prompt.trim()) return;
                  void mutate("create", () => snapshot.actions!.add({
                    name,
                    cronExpression: expression,
                    prompt,
                    timezone,
                    preferredOutputChannel: output,
                  })).then(() => {
                    setName("");
                    setPrompt("");
                  });
                }}
              >
                <Field label="Job name">
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="weekday-ai-brief" />
                </Field>
                <Field label="Cron expression">
                  <input className="font-mono" value={expression} onChange={(event) => setExpression(event.target.value)} spellCheck={false} />
                </Field>
                <div className="cron-presets">
                  {presets.map(([label, value]) => (
                    <button key={value} type="button" onClick={() => setExpression(value)}>{label}</button>
                  ))}
                </div>
                <div className="cron-form-pair">
                  <Field label="Timezone">
                    <input className="font-mono" value={timezone} onChange={(event) => setTimezone(event.target.value)} spellCheck={false} />
                  </Field>
                  <Field label="Deliver to">
                    <input className="font-mono" value={output} onChange={(event) => setOutput(event.target.value)} spellCheck={false} />
                  </Field>
                </div>
                <Field label="Agent prompt">
                  <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Search the latest AgentOS updates, summarize the important changes, and send them to me." rows={6} />
                </Field>
                {error ? <div className="cron-error">{error}</div> : null}
                <button className="cron-primary" disabled={!snapshot?.actions || Boolean(busy) || !name.trim() || !prompt.trim()}>
                  {busy === "create" ? "CREATING…" : "CREATE SCHEDULE"}
                </button>
              </form>
            </CardContent>
          </Card>

          <section className="cron-jobs">
            <div className="cron-section-head">
              <div>
                <p className="cron-eyebrow">PERSISTED AUTOMATIONS</p>
                <h2>Schedule registry</h2>
              </div>
              <button
                type="button"
                disabled={!snapshot?.actions || Boolean(busy)}
                onClick={() => snapshot?.actions && void mutate("refresh", snapshot.actions.refresh)}
              >
                {busy === "refresh" ? "SYNCING…" : "REFRESH"}
              </button>
            </div>
            {jobs.length === 0 ? (
              <div className="cron-empty">
                <span>00</span>
                <p>No schedules committed.</p>
              </div>
            ) : (
              <div className="cron-job-list">
                {jobs.map((job, index) => (
                  <article key={job.id} className="cron-job">
                    <div className="cron-job-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="cron-job-main">
                      <div className="cron-job-title">
                        <div>
                          <h3>{job.name}</h3>
                          <code>{job.cronExpression} · {job.timezone}</code>
                        </div>
                        <Badge variant={job.status === "active" ? "success" : "outline"}>{job.status}</Badge>
                      </div>
                      <p className="cron-prompt">{job.prompt}</p>
                      <div className="cron-job-meta">
                        <span>OUTPUT <b>{job.preferredOutputChannel ?? "auto"}</b></span>
                        <span>LAST RUN <b>{formatDate(job.lastRunAt)}</b></span>
                        <span>UPDATED <b>{formatDate(job.updatedAt)}</b></span>
                      </div>
                      {job.lastError ? <div className="cron-error">{job.lastError}</div> : null}
                      <div className="cron-actions">
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          onClick={() => snapshot?.actions && void mutate(job.id, () => job.status === "active" ? snapshot.actions!.suspend(job.id) : snapshot.actions!.resume(job.id))}
                        >
                          {job.status === "active" ? "SUSPEND" : "RESUME"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={Boolean(busy)}
                          onClick={() => snapshot?.actions && window.confirm(`Remove ${job.name}?`) && void mutate(job.id, () => snapshot.actions!.remove(job.id))}
                        >
                          REMOVE
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="cron-footer-grid">
          <Card>
            <CardHeader><CardTitle>Runtime policy</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Policy label="Default timezone" value={snapshot?.policy.defaultTimezone ?? "—"} />
              <Policy label="Default output" value={snapshot?.policy.preferredOutputChannel ?? "auto"} />
              <Policy label="Second-level jobs" value={snapshot?.policy.allowSeconds ? "allowed" : "blocked"} />
              <Policy label="No overlap" value="enforced" />
            </CardContent>
          </Card>
          <InstanceSummary component={component} />
        </div>
      </div>
    </MicrofrontendFrame>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="cron-field"><span>{label}</span>{children}</label>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "live" | "error" }) {
  return <div className="cron-metric"><p>{label}</p><strong className={tone}>{value}</strong></div>;
}

function Policy({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><code className="text-xs">{value}</code></div>;
}

function formatDate(value?: string): string {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
