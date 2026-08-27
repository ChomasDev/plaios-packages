# @agent-os/orchestrator-default

The default Agent OS router. It combines deterministic delivery rules with an injected `AIProvider` and `CapabilityDiscovery` implementation to select tools and response channels. It also extracts bounded durable-memory proposals.

Install it after an AI and discovery capability, or use the AgentOS Store; the dynamic host injects those live dependencies automatically.

```bash
pnpm add @agent-os/orchestrator-default --registry http://localhost:4873
```
