# @agent-os/codex

Codex AI capability for Agent OS. It implements the provider-neutral `AIProvider` contract, including text and image inputs, structured function calls, capability execution loops, cancellation, and timeouts.

By default the provider starts one Codex `app-server` lazily and keeps it alive across requests. Runtime reloads close it cleanly, and an unexpected exit is restarted on the next request. Set `persistentProcess: false` only when compatibility with an older Codex CLI is required.

For a single unambiguous state-changing capability call, Codex can generate a natural confirmation together with the tool arguments. Agent OS emits it only after the capability reports success, avoiding a second model round-trip. Reads, failures, delayed sequences, and multi-step requests continue through the result-aware loop.

## Install

```bash
pnpm add @agent-os/codex --registry http://localhost:4873
```

Or open the Store in `agentos start` and choose **Install**. Agent OS discovers the `codex.ai` interface and creates its configuration automatically.

## Configuration

The safe defaults are `read-only` sandboxing, `never` approval policy, disabled network access, and disabled web search. Authentication uses `CODEX_API_KEY` when supplied, otherwise the local Codex login/session.

```yaml
- package: "@agent-os/codex"
  version: 0.1.2
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
