# OpenRouter-compatible API input

`@plaios/input-openrouter-api` exposes PLAIOS through an
OpenAI/OpenRouter-compatible HTTP API. The adapter implements both
`InputInterface` and `OutputInterface`; register the same instance as an input
and an output so concurrent HTTP responses remain correlated with their
originating requests.

```ts
import { OpenRouterApiInput } from "@plaios/input-openrouter-api";

const webApi = new OpenRouterApiInput({
  hostname: "127.0.0.1",
  port: 3000,
  apiKey: process.env.AGENT_OS_API_KEY,
  models: ["agent-os"],
  onLog: (event) => console.log("[openrouter-api]", event),
});

os.boot({
  // ...
  input: [webApi],
  output: [webApi],
});
```

Supported endpoints:

- `POST /v1/chat/completions`
- `POST /api/v1/chat/completions`
- `POST /v1/responses`
- `POST /api/v1/responses`
- `GET /v1/models`
- `GET /api/v1/models`
- `GET /v1/models/{id}`
- `GET /api/v1/models/{id}`
- `GET /health`

Both regular JSON completions and `stream: true` server-sent events are
supported. Browser clients can use CORS; the default allows all origins, so set
`corsOrigins` explicitly for a deployed service.

Set `openClawCompatibility: true` to emit OpenClaw-owned model objects and to
accept OpenClaw's `x-openclaw-agent-id`, `x-openclaw-model`,
`x-openclaw-session-key`, and `x-openclaw-message-channel` headers. Configure
the advertised aliases through `models`, for example `openclaw`,
`openclaw/default`, and `openclaw/<agentId>`.
