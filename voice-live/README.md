# Live Voice input

`@agent-os/voice-live` adds a real-time voice agent to the Agent OS web UI.
The browser opens a WebRTC call to the OpenAI Realtime API; the backend only
mints short-lived client secrets and executes tools, so the API key never
reaches the browser.

Every capability registered in discovery is exposed to the voice model as a
function tool. When the model calls one, the microfrontend forwards it to the
runtime (`callTool`), which runs the capability and returns the result to the
model, which then answers out loud.

Config: `OPENAI_API_KEY` (required), `VOICE_LIVE_MODEL` (default `gpt-realtime`),
`VOICE_LIVE_VOICE` (default `marin`), `VOICE_LIVE_INSTRUCTIONS`.
