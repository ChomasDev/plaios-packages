"use client";

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, Input, InstanceSummary, Label, MicrofrontendFrame, type MicrofrontendProps } from "@plaios/microfrontend";
import { useState, type FormEvent } from "react";

type Provider = "google" | "outlook" | "imap";
interface AccountStatus { id: string; label: string; provider: Provider; user: string; host: string; mailbox: string; enabled: boolean; state: "connecting" | "watching" | "error" | "off"; error?: string; lastCheckedAt?: string }
interface EmailSummary { id: string; account: string; from: string; subject: string; date: string; category: string; importance: number; important: boolean; snippet: string; notified: boolean }
interface NewAccount { label: string; provider: Provider; user: string; auth: "password" | "oauth2"; password?: string; clientId?: string; clientSecret?: string; refreshToken?: string; tenant?: string; host?: string; port?: number; secure?: boolean; mailbox?: string }
interface EmailData {
  outputChannel: string;
  categories: string[];
  threshold: number;
  system1: boolean;
  accounts: AccountStatus[];
  emails: EmailSummary[];
  actions: { addAccount(input: NewAccount): Promise<EmailData>; removeAccount(id: string): Promise<EmailData>; setEnabled(id: string, enabled: boolean): Promise<EmailData> };
}

const STATE: Record<AccountStatus["state"], { label: string; variant: "success" | "secondary" | "outline" }> = {
  watching: { label: "Watching", variant: "success" },
  connecting: { label: "Connecting", variant: "secondary" },
  error: { label: "Error", variant: "outline" },
  off: { label: "Off", variant: "outline" },
};

export default function EmailMicrofrontend({ component, data, onSaveConfig }: MicrofrontendProps<EmailData>) {
  const [view, setView] = useState<EmailData | undefined>();
  const current = view ?? data;
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<EmailData> | undefined) => {
    setError(undefined);
    try { const next = await action(); if (next) setView(next); } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  return <MicrofrontendFrame component={component} title="Email" description="Every new email is sorted by the fast model; important ones are saved to memory and sent to you.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Latest emails</CardTitle><CardDescription>Important above {Math.round((current?.threshold ?? 0.7) * 100)}% are remembered and notified on {current?.outputChannel ?? "the output"}.</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {current?.emails.length ? current.emails.map((email) => <div key={email.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${email.important ? "bg-amber-500" : "bg-muted-foreground/30"}`} title={`Importance ${Math.round(email.importance * 100)}%`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{email.subject}</span>{email.notified ? <Badge variant="secondary">Notified</Badge> : null}</div>
                <p className="truncate text-xs text-muted-foreground">{email.from} · {email.account} · {new Date(email.date).toLocaleString()}</p>
              </div>
              <Badge variant="outline">{email.category}</Badge>
            </div>) : <p className="text-sm text-muted-foreground">No emails yet. New mail appears here as it arrives.</p>}
          </CardContent>
        </Card>
        <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      </div>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Mailboxes</CardTitle><CardDescription>{current?.system1 ? "Sorted by the fast model." : "No fast model: every email counts as important."}</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {(current?.accounts ?? []).map((account) => <div key={account.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{account.label}</span><Badge variant={STATE[account.state].variant}>{STATE[account.state].label}</Badge></div>
              <p className="truncate text-xs text-muted-foreground">{account.user} · {account.host} · {account.mailbox}</p>
              {account.error ? <p className="mt-1 text-xs text-destructive">{account.error}</p> : null}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void run(() => current?.actions.setEnabled(account.id, !account.enabled))}>{account.enabled ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Remove ${account.label}?`)) void run(() => current?.actions.removeAccount(account.id)); }}>Remove</Button>
              </div>
            </div>)}
            <AddAccount onAdd={(input) => run(() => current?.actions.addAccount(input))} />
          </CardContent>
        </Card>
        <InstanceSummary component={component} />
      </div>
    </div>
  </MicrofrontendFrame>;
}

/** Google and Outlook fill the server; IMAP asks for it. Passwords are app passwords; OAuth needs your own app's client and a refresh token. */
function AddAccount({ onAdd }: { onAdd(input: NewAccount): Promise<void> }) {
  const [form, setForm] = useState<NewAccount>({ label: "", provider: "google", user: "", auth: "password" });
  const [busy, setBusy] = useState(false);
  const set = (fields: Partial<NewAccount>) => setForm((previous) => ({ ...previous, ...fields }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await onAdd(form);
    setBusy(false);
    setForm({ label: "", provider: form.provider, user: "", auth: form.auth });
  };
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 border-t pt-3">
    <p className="text-sm font-medium">Add a mailbox</p>
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs">
      {(["google", "outlook", "imap"] as const).map((provider) => <button key={provider} type="button" onClick={() => set({ provider, auth: provider === "outlook" ? "oauth2" : form.auth })} className={`rounded-md py-1 ${form.provider === provider ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{provider === "google" ? "Gmail" : provider === "outlook" ? "Outlook" : "IMAP"}</button>)}
    </div>
    <Field label="Name" value={form.label} onChange={(label) => set({ label })} placeholder="Work mail" />
    <Field label="Email address" value={form.user} onChange={(user) => set({ user })} placeholder="you@example.com" required />
    {form.provider === "imap" ? <div className="grid grid-cols-[1fr_5rem] gap-2"><Field label="IMAP server" value={form.host ?? ""} onChange={(host) => set({ host })} placeholder="imap.example.com" required /><Field label="Port" value={String(form.port ?? 993)} onChange={(port) => set({ port: Number(port) || 993 })} /></div> : null}
    {form.provider !== "imap" ? <div className="flex gap-3 text-xs">
      {(["password", "oauth2"] as const).map((auth) => <label key={auth} className="flex items-center gap-1.5"><input type="radio" checked={form.auth === auth} onChange={() => set({ auth })} />{auth === "password" ? "App password" : "OAuth2"}</label>)}
    </div> : null}
    {form.auth === "password" || form.provider === "imap"
      ? <Field label={form.provider === "google" ? "App password (Google account → Security → App passwords)" : "Password"} type="password" value={form.password ?? ""} onChange={(password) => set({ password })} required />
      : <>
        <Field label="Client id" value={form.clientId ?? ""} onChange={(clientId) => set({ clientId })} required />
        <Field label="Client secret (if your app has one)" type="password" value={form.clientSecret ?? ""} onChange={(clientSecret) => set({ clientSecret })} />
        <Field label="Refresh token" type="password" value={form.refreshToken ?? ""} onChange={(refreshToken) => set({ refreshToken })} required />
        {form.provider === "outlook" ? <Field label="Tenant (empty for personal accounts)" value={form.tenant ?? ""} onChange={(tenant) => set({ tenant })} placeholder="common" /> : null}
      </>}
    <p className="text-xs text-muted-foreground">The login is tested before saving; passwords and tokens are stored encrypted and never shown again.</p>
    <Button type="submit" size="sm" disabled={busy}>{busy ? "Connecting…" : "Add mailbox"}</Button>
  </form>;
}

function Field({ label, value, onChange, type = "text", placeholder, required }: { label: string; value: string; onChange(value: string): void; type?: string; placeholder?: string; required?: boolean }) {
  return <div className="grid gap-1"><Label className="text-xs text-muted-foreground">{label}</Label><Input type={type} value={value} placeholder={placeholder} required={required} onChange={(event) => onChange(event.target.value)} autoComplete="off" /></div>;
}
