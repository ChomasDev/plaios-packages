# AgentOS Cron Scheduler

Persistent five-field cron schedules that enter AgentOS through the normal input pipeline. The same live adapter exposes the `cronjobs.manage` capability, so jobs created by an agent or the management surface are scheduled immediately and survive restarts.

Schedules use an IANA timezone and carry a preferred output channel. Six-field, second-level schedules are disabled by default to protect model and API budgets.

```yaml
- package: "@plaios/cronjob"
  version: 0.1.0
  interface: cronjob.input
  instanceId: input:cronjob
  config:
    defaultTimezone: Europe/Rome
    preferredOutputChannel: telegram
    maxJobs: 100
    allowSeconds: false
```
