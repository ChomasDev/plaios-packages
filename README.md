# AgentOs-packages

The plugin packages for [Agent OS](https://github.com/ChomasDev/AgentOs-core): inputs, outputs, models, memory, orchestrators and actions. Each folder is one npm package with an `agent-os.package.yaml` manifest.

This repo is not built on its own. It is mounted as the `packages/` submodule of **AgentOs-core**, which provides `@agent-os/core`, `@agent-os/microfrontend` and the pnpm workspace every package here depends on (`workspace:*`).

```bash
git clone --recursive https://github.com/ChomasDev/AgentOs-core.git
cd AgentOs-core && pnpm install && pnpm build
```

See the [AgentOs-core README](https://github.com/ChomasDev/AgentOs-core#readme) for the full run tutorial.

## Packages

| Package | What it does |
| --- | --- |
| [`@agent-os/action-cli`](action-cli) | Allowlisted, shell-free CLI inspection capability for Agent OS |
| [`@agent-os/action-gods-eye-view`](action-gods-eye-view) | A native Mapbox 3D globe for Agent OS with AI control and progressive geospatial layers |
| [`@agent-os/action-home-assistant`](action-home-assistant) | Dynamic Home Assistant controls and agent capability for Agent OS |
| [`@agent-os/action-memory-retrieval`](action-memory-retrieval) | Focused graph-memory retrieval action for Agent OS |
| [`@agent-os/action-perplexity-search`](action-perplexity-search) | Live Perplexity web-search action for Agent OS |
| [`@agent-os/action-ssh`](action-ssh) | SSH remote control for paired Macs and Linux computers, with TypeSafe Jev natural-language routing |
| [`@agent-os/action-tiktok-series`](action-tiktok-series) | Daily TikTok trend research (Apify) and series brief for go2match episodes |
| [`@agent-os/agent-loop`](agent-loop) | Default model and capability execution loop for Agent OS |
| [`agentos`](cli) | Agent OS command line entrypoint |
| [`@agent-os/codex`](codex) | Codex AI provider and management surface for Agent OS |
| [`@agent-os/cronjob`](cronjob) | Persistent cron input and schedule-management capability for Agent OS |
| [`@agent-os/discovery-memory`](discovery-memory) | In-memory capability discovery and registry for Agent OS |
| [`@agent-os/env-node`](env-node) | Process, dotenv, map, and composite environment adapters for Agent OS |
| [`@agent-os/jev-orchestrator`](jev-orchestrator) | TypeSafe Jev orchestrator that can send natural-language commands directly to capabilities |
| [`@agent-os/memory-graph`](memory-graph) | Weighted, decaying, vector-ranked graph memory capability for Agent OS |
| [`@agent-os/openrouter-api`](openrouter-api) | OpenAI/OpenRouter-compatible HTTP input and output with OpenClaw protocol support |
| [`@agent-os/orchestrator-default`](orchestrator-default) | Model-backed capability and output router for Agent OS |
| [`@agent-os/sqlite`](sqlite) | Capability-scoped SQLite database and management console for Agent OS |
| [`@agent-os/system1-jev`](system1-jev) | TypeSafe Jev System 1 for Agent OS |
| [`@agent-os/systems`](systems) | Shared System 1 / System 2 helpers for Agent OS plugins: question builders, System 2 ask, remembered protocols |
| [`@agent-os/telegram`](telegram) | Telegram input and output capability for Agent OS |
| [`@agent-os/voice-live`](voice-live) | Live voice input: OpenAI Realtime (WebRTC) agent that speaks in real time and calls every Agent OS capability as a tool |

## Adding a package

From the AgentOs-core root, `pnpm agentos create action weather` scaffolds `packages/weather` (that is, a new folder in this repo). Commit it here, then bump the submodule pointer in AgentOs-core.

## Notes

- `action-gods-eye-view/vendor/gods-eye-view` vendors [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT). Its `private/` build output and `docs/media/` GIFs are not committed.
