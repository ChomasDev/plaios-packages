"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, ConfigurationEditor, InstanceSummary, MicrofrontendFrame, type MicrofrontendProps } from "@agent-os/microfrontend";

const ROLES = [
  ["Asked by", "Orchestrators and Jev actions, before System 2"],
  ["Answers", "Yes/no as a probability, a choice, or a score"],
  ["Falls back to", "System 2, when the key is missing or Jev fails"],
] as const;

export default function JevSystem1Microfrontend({ component, onSaveConfig }: MicrofrontendProps) {
  return <MicrofrontendFrame component={component} title="Jev System 1" description="TypeSafe Jev answers the fast, typed questions plugins ask, so most routing decisions never wait for the generative model.">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <ConfigurationEditor component={component} onSaveConfig={onSaveConfig} />
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>How it is used</CardTitle><CardDescription>System 1 is the fast half of the model pair.</CardDescription></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {ROLES.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="max-w-52 text-right">{value}</span></div>)}
          </CardContent>
        </Card>
        <InstanceSummary component={component} />
      </div>
    </div>
  </MicrofrontendFrame>;
}
