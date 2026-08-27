# @agent-os/codex

Codex AI capability for Agent OS. It implements the provider-neutral `AIProvider` contract, including text and image inputs, structured function calls, capability execution loops, cancellation, and timeouts.

## Install

```bash
pnpm add @agent-os/codex --registry http://localhost:4873
```

Or open the Store in `agentos start` and choose **Install**. Agent OS discovers the `codex.ai` interface and creates its configuration automatically.

## Configuration

The safe defaults are `read-only` sandboxing, `never` approval policy, disabled network access, and disabled web search. Authentication uses `CODEX_API_KEY` when supplied, otherwise the local Codex login/session.

```yaml
- package: "@agent-os/codex"
  version: 0.1.0
  interface: codex.ai
  instanceId: ai:codex
  config:
    model: gpt-5.6-sol
    sandboxMode: read-only
    approvalPolicy: never
    networkAccessEnabled: false
    webSearchMode: disabled
```

## Runtime

```ts
import { CodexProvider } from "@agent-os/codex";

const provider = new CodexProvider({ model: "gpt-5.6-sol" });
const result = await provider.processInput("Explain this runtime in one paragraph.");
```

The package also exports `@agent-os/codex/web/ai`, a management microfrontend for settings, provider status, and the effective security boundary.
