# @agent-os/env-node

Node.js process, dotenv, map, and composite environment providers for Agent OS.
The dotenv and composite web surfaces can add and edit project-local variables.
Secret-looking keys such as `TOKEN`, `PASSWORD`, and `API_KEY` are masked and
their values are never returned to the browser after saving.

Node.js environment capability for Agent OS. It includes process, dotenv, map, and composite implementations of the provider-neutral `Environment` contract.

The management microfrontend only lists keys declared in `.env.example` or already present in `.env`. Secret-looking keys are masked and never cross the runtime bridge. Process overrides are read-only.

Install from the AgentOS Store or directly:

```bash
pnpm add @agent-os/env-node --registry http://localhost:4873
```
