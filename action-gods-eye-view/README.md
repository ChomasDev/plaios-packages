# God's Eye View action

A downloadable Agent OS action containing the complete MIT-licensed [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) application by Bilawal Sidhu.

The package vendors the upstream source, assets, documentation, and live-feed middleware. Its Agent OS surface now uses Mapbox GL JS directly instead of the upstream Cesium renderer. The original implementation remains in the package as migration reference while its layers are ported to Mapbox one at a time.

## What it adds

- A focused, `cmdk`-style Agent OS command palette with `Cmd/Ctrl+K`.
- A native Mapbox GL JS globe with Mapbox Terrain-DEM and 3D buildings.
- Satellite 3D, Standard 3D, Outdoors 3D, and flat terrain choices.
- A compact Shadcn-style terrain/layer popover beside search, with restrained Lucide icons.
- Direct Mapbox gestures, an optional pan/orbit/tilt control pad, Mapbox geocoding, and a clean full-canvas layout.
- A live, viewport-aware CCTV layer with compact heading-aware low-poly models, x-ray locator rings, and a selected-camera 3D field-of-view volume.
- A clean Agent OS right inspector with live camera media, source, area, feed type, direction, manual refresh, and a distraction-free full-screen view. Native video feeds play continuously; snapshot-only sources refresh every 7 seconds in the inspector and every 2.5 seconds full screen.
- Building-aware mounting at close zoom: cameras prefer the nearest rendered 3D wall and use a grounded low-poly support pole when no suitable wall is nearby.
- A distinct low-poly traffic-light model for catalog entries explicitly identified as red-light or signal-enforcement cameras.
- `gods-eye-view.open` AI capability and a `postMessage` bridge for Agent OS navigation commands.
- Honest migration placeholders for the remaining live data layers that have not yet been ported.
- Local macOS browser opening or remote opening through `@agent-os/action-ssh`.
- Procedural memory for **“occhio di dio”**.

## Configuration

```yaml
- package: "@agent-os/action-gods-eye-view"
  version: 0.7.0
  interface: gods-eye-view.action
  instanceId: action:gods-eye-view
  config:
    baseUrl: http://localhost:4173
    bundledServer: true
    protocolTrigger: occhio di dio
    launchMode: auto
    mapboxAccessToken: pk.example
    mapboxStyle: mapbox/standard-satellite
```

The Mapbox public access token is required for the embedded Agent OS surface. Keep it in `.env`; it is not included in the downloadable archive.

| Setting               | Purpose                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `MAPBOX_ACCESS_TOKEN` | Required public `pk` token for the Mapbox globe, terrain, styles, and geocoding.      |
| `MAPBOX_STYLE`        | Initial Mapbox style as `username/style-id`; defaults to `mapbox/standard-satellite`. |
| `GOOGLE_MAPS_API_KEY` | Used only by the retained upstream standalone implementation.                         |
| `CESIUM_ION_TOKEN`    | Used only by the retained upstream standalone implementation.                         |
| `OPENAI_API_KEY`      | Enables the retained upstream realtime voice interface.                               |

The embedded map uses Mapbox GL JS, the globe projection, Mapbox Standard styles, and the Mapbox Terrain-DEM raster source. Required Mapbox/OpenStreetMap attribution remains visible.

## AI requests

The current Mapbox-native capability handles direct requests such as:

- `Open Treviso in Mapbox 3D`
- `Give me all the cameras at Treviso`
- `Apri occhio di dio su Londra`
- `Use the outdoors terrain`
- `Show the flat map`
- `Reset to the whole globe`

Place search, coordinate navigation, zoom, globe reset, terrain/style switching, and CCTV cameras are live. Camera prompts automatically enable the camera layer; only catalog entries inside the current viewport are rendered, and selecting one opens its media in the right inspector plus a heading-aware field-of-view volume on the map. True video sources play continuously. Sources that only publish still images are presented honestly as live snapshots and polled automatically. The expand button opens the feed across the complete webview, increases snapshot polling to every 2.5 seconds, and preserves the full source image with letterboxing on wide displays instead of cropping it; Escape returns to the inspector. At close zoom, ordinary cameras are anchored to the nearest visible Mapbox building wall when one can be resolved. Cameras without a nearby wall receive a grounded low-poly support pole at their source coordinate, so the model never appears unsupported. Flights, military, vessels, satellites, traffic, earthquakes, and wildfires remain visible in the panel as **Soon** while their renderers are moved to Mapbox.

Red-light detection is deliberately conservative: the traffic-light model is used only when a source name or metadata explicitly includes `red light`, `traffic signal`, or `signal enforcement`. The current bundled live catalog does not expose a formal red-light boolean, so ordinary traffic cameras are not guessed into that category.

Mouse controls follow Mapbox conventions: drag to pan, right-drag (or Control-drag) to orbit, and scroll to zoom. The mouse button under the standard navigation controls opens accessible pan, rotate, pitch, and reset buttons.

## Attribution and source

The vendored application remains under its upstream MIT license. `vendor/gods-eye-view/LICENSE`, `DATA_SOURCES.md`, and the full source tree are included in the package. Mapbox GL JS and Mapbox-hosted styles, terrain, imagery, and search remain governed by Mapbox's terms and attribution requirements.

The camera assets are bundled locally so the map does not rely on third-party model hosting at runtime:

- [Security Camera](https://poly.pizza/m/a6J7IDufQP) by J-Toastie, licensed under CC BY 3.0.
- [Traffic light](https://poly.pizza/m/aYC3t5ymln) by Kay Lousberg, licensed under CC0 1.0.

The same credits are included beside the packaged model files in `vendor/gods-eye-view/public/models/ATTRIBUTION.md`.
