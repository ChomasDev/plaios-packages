# @plaios/action-home-assistant

A dynamic Home Assistant control package for PLAIOS. It discovers configured entity domains, exposes safe controls in the PLAIOS UI, and gives the agent a bounded `control_home_assistant` capability.

The agent can read live entity states and control lights, switches, TVs and other media players, fans, covers, locks, climate entities, scenes, scripts, and input booleans. Media controls include power, volume, mute, play, pause, and stop. Home Assistant credentials stay in the server-side environment and are never returned through the microfrontend bridge.

## Configuration

Create a Home Assistant long-lived access token from your Home Assistant profile, then provide:

```dotenv
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=replace-with-your-long-lived-access-token
```

The optional `entityDomains` component setting is a comma-separated allowlist. Its default is:

```text
light,switch,fan,cover,lock,climate,scene,script,input_boolean,media_player
```

## Install

Install it from the PLAIOS Store, or add it directly to `plaios.yaml`:

```yaml
components:
  - package: "@plaios/action-home-assistant"
    version: latest
    interface: home-assistant.action
    instanceId: action:home-assistant
    config: {}
```
