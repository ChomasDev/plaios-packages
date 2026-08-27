# @agent-os/discovery-memory

The default in-memory implementation of Agent OS `CapabilityDiscovery`. It keeps multiple registered versions, returns the latest by default, and matches explicit request tokens and tags without fuzzy substring false positives.

```bash
pnpm add @agent-os/discovery-memory --registry http://localhost:4873
```
