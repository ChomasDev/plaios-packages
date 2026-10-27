# plaios-packages

The plugin packages for [PLAIOS](https://github.com/ChomasDev/plaios): inputs, outputs, models, memory, orchestrators and actions. Each folder is one npm package with an `agent-os.package.yaml` manifest.

This repo is not built on its own. It is mounted as the `packages/` submodule of **plaios**, which provides `@plaios/core`, `@plaios/microfrontend` and the pnpm workspace every package here depends on (`workspace:*`).

```bash
git clone --recursive https://github.com/ChomasDev/plaios.git
cd plaios && pnpm install && pnpm build
```

See the [plaios README](https://github.com/ChomasDev/plaios#readme) for the full run tutorial.

## Packages

| Package | What it does |
| --- | --- |
| [`@plaios/action-cli`](action-cli) | Allowlisted, shell-free CLI inspection capability for PLAIOS |
| [`@plaios/action-gods-eye-view`](action-gods-eye-view) | A native Mapbox 3D globe for PLAIOS with AI control and progressive geospatial layers |
| [`@plaios/action-home-assistant`](action-home-assistant) | Dynamic Home Assistant controls and agent capability for PLAIOS |
| [`@plaios/action-memory-retrieval`](action-memory-retrieval) | Focused graph-memory retrieval action for PLAIOS |
| [`@plaios/action-perplexity-search`](action-perplexity-search) | Live Perplexity web-search action for PLAIOS |
| [`@plaios/action-ssh`](action-ssh) | SSH remote control for paired Macs and Linux computers, with TypeSafe Jev natural-language routing |
| [`@plaios/action-tiktok-series`](action-tiktok-series) | Daily TikTok trend research (Apify) and series brief for go2match episodes |
| [`@plaios/agent-loop`](agent-loop) | Default model and capability execution loop for PLAIOS |
| [`plaios`](cli) | PLAIOS command line entrypoint |
| [`@plaios/codex`](codex) | Codex AI provider and management surface for PLAIOS |
| [`@plaios/cronjob`](cronjob) | Persistent cron input and schedule-management capability for PLAIOS |
| [`@plaios/discovery-memory`](discovery-memory) | In-memory capability discovery and registry for PLAIOS |
| [`@plaios/env-node`](env-node) | Process, dotenv, map, and composite environment adapters for PLAIOS |
| [`@plaios/jev-orchestrator`](jev-orchestrator) | TypeSafe Jev orchestrator that can send natural-language commands directly to capabilities |
| [`@plaios/memory-graph`](memory-graph) | Weighted, decaying, vector-ranked graph memory capability for PLAIOS |
| [`@plaios/openrouter-api`](openrouter-api) | OpenAI/OpenRouter-compatible HTTP input and output with OpenClaw protocol support |
| [`@plaios/orchestrator-default`](orchestrator-default) | Model-backed capability and output router for PLAIOS |
| [`@plaios/sqlite`](sqlite) | Capability-scoped SQLite database and management console for PLAIOS |
| [`@plaios/system1-jev`](system1-jev) | TypeSafe Jev System 1 for PLAIOS |
| [`@plaios/systems`](systems) | Shared System 1 / System 2 helpers for PLAIOS plugins: question builders, System 2 ask, remembered protocols |
| [`@plaios/telegram`](telegram) | Telegram input and output capability for PLAIOS |
| [`@plaios/voice-live`](voice-live) | Live voice input: OpenAI Realtime (WebRTC) agent that speaks in real time and calls every PLAIOS capability as a tool |

## Adding a package

From the plaios root, `pnpm plaios create action weather` scaffolds `packages/weather` (that is, a new folder in this repo). Commit it here, then bump the submodule pointer in plaios.

## Notes

- `action-gods-eye-view/vendor/gods-eye-view` vendors [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT). Its `private/` build output and `docs/media/` GIFs are not committed.
