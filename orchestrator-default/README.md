# @agent-os/orchestrator-default

The default Agent OS router. It combines deterministic delivery rules with an injected `AIProvider` and `CapabilityDiscovery` implementation to select tools and response channels. It also extracts bounded durable-memory proposals.

With `fastPath` enabled, single-output messages are routed entirely from live capability manifests and discovery scores, with the configured baseline capabilities appended. This removes a model round-trip without relying on command phrases or a fixed device list.

Install it after an AI and discovery capability, or use the AgentOS Store; the dynamic host injects those live dependencies automatically.

```bash
pnpm add @agent-os/orchestrator-default --registry http://localhost:4873
```
