import * as Cesium from 'cesium';
import { setScopeMaskEnabled } from './scopeMask.js';

const MESSAGE_TYPE = 'agent-os:gods-eye-view';

const COMMAND_SUGGESTIONS = Object.freeze([
  ['Show cameras', 'Enable the live CCTV layer'],
  ['Show flights', 'Enable civilian aircraft'],
  ['Show vessels', 'Enable AIS vessel traffic'],
  ['Show satellites', 'Enable orbital objects'],
  ['Go to Treviso', 'Search and move the map'],
  ['Reset globe', 'Return to the global view'],
]);

const LAYER_COMMANDS = Object.freeze([
  { id: 'cctv', label: 'Cameras', icon: 'camera' },
  { id: 'flights', label: 'Flights', icon: 'plane' },
  { id: 'military', label: 'Military', icon: 'shield' },
  { id: 'ais-live-vessels', label: 'Vessels', icon: 'ship' },
  { id: 'satellites', label: 'Satellites', icon: 'satellite' },
  { id: 'traffic', label: 'Traffic', icon: 'car' },
  { id: 'earthquakes', label: 'Earthquakes', icon: 'activity' },
  { id: 'local-firms', label: 'Wildfires', icon: 'flame' },
]);

const TERRAIN_COMMANDS = Object.freeze([
  {
    id: 'mapbox',
    label: 'Mapbox 3D',
    detail: 'Satellite',
    icon: 'mountain',
  },
  {
    id: 'esri-imagery',
    label: 'Esri 3D',
    detail: 'Satellite',
    icon: 'satelliteDish',
  },
  { id: 'osm', label: 'Streets 3D', detail: 'Open map', icon: 'map' },
  { id: 'flat', label: 'Flat globe', detail: 'Faster', icon: 'circle' },
]);

const LUCIDE_PATHS = Object.freeze({
  search: [
    ['circle', { cx: 11, cy: 11, r: 8 }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  layers: [
    [
      'path',
      {
        d: 'm12.8 2.2 8.6 3.9a1 1 0 0 1 0 1.8l-8.6 3.9a2 2 0 0 1-1.6 0L2.6 7.9a1 1 0 0 1 0-1.8l8.6-3.9a2 2 0 0 1 1.6 0Z',
      },
    ],
    ['path', { d: 'm22 12.5-9.2 4.2a2 2 0 0 1-1.6 0L2 12.5' }],
    ['path', { d: 'm22 17.5-9.2 4.2a2 2 0 0 1-1.6 0L2 17.5' }],
  ],
  camera: [
    [
      'path',
      {
        d: 'M14.5 4 16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2Z',
      },
    ],
    ['circle', { cx: 12, cy: 13, r: 3 }],
  ],
  plane: [
    [
      'path',
      {
        d: 'M17.8 19 9 14l-7 2v-3l7-3 8.8-5c1.1-.6 2.5-.3 3.2.8.6 1.1.3 2.5-.8 3.2L15 12l5 5-2.2 2Z',
      },
    ],
  ],
  shield: [
    ['path', { d: 'M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z' }],
  ],
  ship: [
    ['path', { d: 'M12 10V3m-4 7 4-3 4 3' }],
    ['path', { d: 'M4 13h16l-2 7H6Z' }],
    [
      'path',
      {
        d: 'M2 21c1.2.7 2.5.7 4 0 1.5.7 2.8.7 4 0 1.5.7 2.8.7 4 0 1.5.7 2.8.7 4 0 1.5.7 2.8.7 4 0',
      },
    ],
  ],
  satellite: [
    ['path', { d: 'm13 7 4 4-6 6-4-4Z' }],
    ['path', { d: 'm17 3 4 4-3 3-4-4Zm-7 11-4 4-3-3 4-4Zm9 5-3-3m-8-8L5 5' }],
  ],
  car: [
    ['path', { d: 'm5 17-1 4m15-4 1 4M3 11l2-5h14l2 5v7H3Z' }],
    ['circle', { cx: 7, cy: 15, r: 1 }],
    ['circle', { cx: 17, cy: 15, r: 1 }],
  ],
  activity: [['path', { d: 'M3 12h4l2-7 4 14 2-7h6' }]],
  flame: [
    [
      'path',
      {
        d: 'M12 22c4 0 7-3 7-7 0-3-1.5-5.5-4-8 .2 2-1 3.5-2 4-1-3-2.5-6-5-8 .3 4-3 6-3 10 0 5 3 9 7 9Z',
      },
    ],
  ],
  mountain: [
    ['path', { d: 'm8 3 4 8 2-3 7 13H3Z' }],
    ['path', { d: 'm8 3 3 6-2 2-2-2-4 12' }],
  ],
  satelliteDish: [
    ['path', { d: 'M4 10a8 8 0 0 0 10 10' }],
    ['path', { d: 'M9 15a3 3 0 0 0 4 4' }],
    ['path', { d: 'M16 3a5 5 0 0 1 5 5' }],
    ['path', { d: 'M16 8a1 1 0 0 1 1 1' }],
    ['path', { d: 'm8 22 3-3' }],
  ],
  map: [
    ['path', { d: 'M14.5 4.5 9.5 2 3 5.5v16L9.5 18l5 2.5 6.5-3.5V1Z' }],
    ['path', { d: 'M9.5 2v16m5-13.5v16' }],
  ],
  circle: [['circle', { cx: 12, cy: 12, r: 9 }]],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1' }],
  ],
  box: [
    ['path', { d: 'm21 8-9 5-9-5 9-5Z' }],
    ['path', { d: 'm3 8 9 5v9M21 8l-9 5' }],
  ],
  navigation: [['path', { d: 'm3 11 19-9-9 19-2-8Z' }]],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 10 }],
    ['path', { d: 'M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20' }],
  ],
  layerX: [
    [
      'path',
      {
        d: 'm12.8 2.2 8.6 3.9a1 1 0 0 1 0 1.8l-8.6 3.9a2 2 0 0 1-1.6 0L2.6 7.9a1 1 0 0 1 0-1.8l8.6-3.9a2 2 0 0 1 1.6 0Z',
      },
    ],
    ['path', { d: 'm16 15 5 5m0-5-5 5' }],
  ],
});

function createLucideIcon(name, label = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('lucide');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attributes] of LUCIDE_PATHS[name] || []) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, String(value));
    }
    svg.appendChild(node);
  }
  return svg;
}

function replaceEmbeddedIcons() {
  const replacements = [
    ['#clear-selected-layers', 'layerX'],
    ['#share-btn', 'link'],
    ['#tilt-map-view', 'box'],
    ['#north-up-view', 'navigation'],
    ['#reset-globe-view', 'globe'],
  ];
  for (const [selector, icon] of replacements) {
    const button = document.querySelector(selector);
    if (!button) continue;
    button.replaceChildren(createLucideIcon(icon));
  }
}

function isTrustedAgentOsOrigin(origin) {
  try {
    const url = new URL(origin);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function configureNaturalMapNavigation(viewer) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  if (!controller) return;
  controller.enableInputs = true;
  controller.enableRotate = true;
  controller.enableTranslate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.enableLook = false;
  // Respond to the gesture instead of coasting after it. These bindings follow
  // ordinary web maps: drag to move, wheel/pinch to zoom, right-drag to tilt.
  controller.inertiaSpin = 0.05;
  controller.inertiaTranslate = 0.05;
  controller.inertiaZoom = 0.05;
  controller.maximumMovementRatio = 0.12;
  controller.bounceAnimationTime = 0.15;
  controller.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
  controller.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,
    Cesium.CameraEventType.PINCH,
  ];
  controller.tiltEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];
  controller.lookEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG];

  const interruptFlight = () => viewer.camera?.cancelFlight?.();
  viewer.canvas?.addEventListener?.('pointerdown', interruptFlight, {
    passive: true,
  });
  viewer.canvas?.addEventListener?.('wheel', interruptFlight, {
    passive: true,
  });
}

function configureEmbeddedRendering(viewer) {
  if (!viewer?.scene) return;
  const dpr = Number(window.devicePixelRatio) || 1;
  // On Retina-class screens a full-resolution Cesium canvas shades millions
  // of extra pixels that an embedded webview cannot visibly resolve.
  viewer.resolutionScale = dpr >= 2 ? 0.72 : dpr > 1.25 ? 0.84 : 1;
  viewer.scene.msaaSamples = 1;
  if (viewer.scene.postProcessStages?.fxaa) {
    viewer.scene.postProcessStages.fxaa.enabled = false;
  }
  if (viewer.scene.globe) {
    viewer.scene.globe.preloadAncestors = false;
    viewer.scene.globe.preloadSiblings = false;
    viewer.scene.globe.tileCacheSize = 140;
  }
  viewer.scene.requestRender?.();
}

function inferCommands(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const commands = [];
  const layers = [
    [/(?:camera|cctv)/, 'cctv'],
    [/(?:flight|plane|aircraft)/, 'flights'],
    [/(?:military)/, 'military'],
    [/(?:vessel|ship|boat)/, 'ais-live-vessels'],
    [/(?:satellite|orbit)/, 'satellites'],
    [/(?:traffic|road)/, 'traffic'],
    [/(?:earthquake|quake)/, 'earthquakes'],
    [/(?:fire|wildfire)/, 'local-firms'],
  ];
  for (const [pattern, layerId] of layers) {
    if (pattern.test(normalized)) {
      commands.push({
        name: 'set_layer_visibility',
        arguments: { layerId, enabled: true },
      });
    }
  }

  if (
    /\b(?:reset|whole|full)\s+(?:the\s+)?globe\b|\bglobal view\b/.test(
      normalized,
    )
  ) {
    commands.push({ name: 'zoom_to_globe', arguments: {} });
  } else if (/\bzoom\s+in\b/.test(normalized)) {
    commands.push({
      name: 'adjust_camera_zoom',
      arguments: { direction: 'in', amount: 'medium' },
    });
  } else if (/\bzoom\s+out\b/.test(normalized)) {
    commands.push({
      name: 'adjust_camera_zoom',
      arguments: { direction: 'out', amount: 'medium' },
    });
  }

  const mapStack = normalized.match(/\b(mapbox|osm|esri|bing)\b/)?.[1];
  if (mapStack) {
    const stackId =
      mapStack === 'osm'
        ? 'osm'
        : mapStack === 'esri'
          ? 'esri-imagery'
          : mapStack === 'bing'
            ? 'bing-aerial'
            : 'mapbox';
    commands.push({ name: 'set_map_stack', arguments: { stack: stackId } });
  }

  const locationMatch = text.match(
    /\b(?:at|in|near|over|around|to)\s+(.+?)(?:\s+(?:with|and)\s+|$)/i,
  );
  if (locationMatch?.[1]) {
    commands.push({
      name: 'fly_to_location',
      arguments: { query: locationMatch[1].trim(), viewMode: 'overview' },
    });
  }
  return commands;
}

function installCommandPalette(application) {
  const root = document.createElement('section');
  root.id = 'agent-os-command';
  root.setAttribute('aria-label', "God's Eye command bar");

  const form = document.createElement('form');
  form.className = 'agent-os-command-form';
  const icon = document.createElement('span');
  icon.className = 'agent-os-command-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(createLucideIcon('search'));
  const input = document.createElement('input');
  input.id = 'agent-os-command-input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Ask about a place or layer…';
  input.setAttribute('aria-label', "Ask God's Eye View");
  input.setAttribute('aria-controls', 'agent-os-command-list');
  input.setAttribute('aria-expanded', 'false');
  const shortcut = document.createElement('kbd');
  shortcut.textContent = '⌘K';
  const layerTrigger = document.createElement('button');
  layerTrigger.type = 'button';
  layerTrigger.className = 'agent-os-layer-trigger';
  layerTrigger.setAttribute('aria-label', 'Choose data layers');
  layerTrigger.setAttribute('aria-expanded', 'false');
  layerTrigger.setAttribute('aria-controls', 'agent-os-layer-popover');
  layerTrigger.appendChild(createLucideIcon('layers'));
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Run';
  form.append(icon, input, shortcut, layerTrigger, submit);

  const list = document.createElement('div');
  list.id = 'agent-os-command-list';
  list.className = 'agent-os-command-list';
  list.setAttribute('role', 'listbox');
  const status = document.createElement('p');
  status.className = 'agent-os-command-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const layerPopover = document.createElement('div');
  layerPopover.id = 'agent-os-layer-popover';
  layerPopover.className = 'agent-os-layer-popover';
  layerPopover.setAttribute('role', 'dialog');
  layerPopover.setAttribute('aria-label', 'Map and data layers');
  const layerHeading = document.createElement('div');
  layerHeading.className = 'agent-os-layer-heading';
  const layerTitle = document.createElement('strong');
  layerTitle.textContent = 'Map & layers';
  const layerHint = document.createElement('span');
  layerHint.textContent = 'Choose the ground and what appears above it';
  layerHeading.append(layerTitle, layerHint);
  const terrainLabel = document.createElement('p');
  terrainLabel.className = 'agent-os-layer-section-label';
  terrainLabel.textContent = 'Terrain';
  const terrainGrid = document.createElement('div');
  terrainGrid.className = 'agent-os-terrain-grid';
  const dataLabel = document.createElement('p');
  dataLabel.className = 'agent-os-layer-section-label';
  dataLabel.textContent = 'Data layers';
  const layerGrid = document.createElement('div');
  layerGrid.className = 'agent-os-layer-grid';
  layerPopover.append(
    layerHeading,
    terrainLabel,
    terrainGrid,
    dataLabel,
    layerGrid,
  );
  const activeLayers = new Set();
  const terrainButtons = new Map();
  let reliefProvider = null;
  let reliefEnabled = true;

  const setOpen = (open) => {
    root.classList.toggle('is-open', open);
    input.setAttribute('aria-expanded', String(open));
    if (open) {
      root.classList.remove('is-layers-open');
      layerTrigger.setAttribute('aria-expanded', 'false');
    }
  };

  const setLayersOpen = (open) => {
    root.classList.toggle('is-layers-open', open);
    layerTrigger.setAttribute('aria-expanded', String(open));
    if (open) setOpen(false);
  };

  const runCommands = async (commands) => {
    const components = await application.start();
    const runAction = components.tools?.voiceCommands?.runAction;
    if (typeof runAction !== 'function') {
      throw new Error('Command runner is not ready');
    }
    for (const command of commands) {
      const result = await runAction(command.name, command.arguments, {
        isCurrent: () => true,
      });
      if (result?.ok === false) {
        throw new Error(result.error || 'Command failed');
      }
    }
  };

  const markTerrainSelection = (id) => {
    for (const [terrainId, button] of terrainButtons) {
      button.setAttribute('aria-pressed', String(terrainId === id));
    }
  };

  for (const terrain of TERRAIN_COMMANDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent-os-terrain-option';
    button.setAttribute('aria-pressed', 'false');
    button.append(createLucideIcon(terrain.icon));
    const copy = document.createElement('span');
    const label = document.createElement('b');
    label.textContent = terrain.label;
    const detail = document.createElement('small');
    detail.textContent = terrain.detail;
    copy.append(label, detail);
    const indicator = document.createElement('i');
    indicator.setAttribute('aria-hidden', 'true');
    button.append(copy, indicator);
    terrainButtons.set(terrain.id, button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.dataset.state = 'working';
      status.textContent = `Loading ${terrain.label.toLowerCase()}…`;
      try {
        const components = await application.start();
        const viewer = components.scene?.viewer;
        const mapStackController = components.scene?.mapStackController;
        if (!viewer || !mapStackController) {
          throw new Error('Map controls are not ready');
        }
        if (terrain.id === 'flat') {
          if (reliefEnabled) reliefProvider = viewer.terrainProvider;
          viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
          reliefEnabled = false;
        } else {
          await mapStackController.setStack(terrain.id);
          const state = mapStackController.getState('ready');
          if (state.activeId !== terrain.id) {
            throw new Error(
              state.lastError || `${terrain.label} is unavailable`,
            );
          }
          if (!reliefEnabled && reliefProvider) {
            viewer.terrainProvider = reliefProvider;
          }
          reliefEnabled = true;
        }
        viewer.scene?.requestRender?.();
        markTerrainSelection(terrain.id);
        status.dataset.state = 'ready';
        status.textContent = `${terrain.label} ready`;
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = error?.message || String(error);
      } finally {
        button.disabled = false;
      }
    });
    terrainGrid.appendChild(button);
  }

  for (const layer of LAYER_COMMANDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agent-os-layer-option';
    button.setAttribute('aria-pressed', 'false');
    button.append(createLucideIcon(layer.icon));
    const label = document.createElement('span');
    label.textContent = layer.label;
    const indicator = document.createElement('i');
    indicator.setAttribute('aria-hidden', 'true');
    button.append(label, indicator);
    button.addEventListener('click', async () => {
      const enabled = !activeLayers.has(layer.id);
      button.disabled = true;
      status.dataset.state = 'working';
      status.textContent = `${enabled ? 'Loading' : 'Hiding'} ${layer.label.toLowerCase()}…`;
      try {
        await runCommands([
          {
            name: 'set_layer_visibility',
            arguments: { layerId: layer.id, enabled },
          },
        ]);
        if (enabled) activeLayers.add(layer.id);
        else activeLayers.delete(layer.id);
        button.setAttribute('aria-pressed', String(enabled));
        status.dataset.state = 'ready';
        status.textContent = enabled
          ? `${layer.label} visible`
          : `${layer.label} hidden`;
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = error?.message || String(error);
      } finally {
        button.disabled = false;
      }
    });
    layerGrid.appendChild(button);
  }

  const renderSuggestions = () => {
    const query = input.value.trim().toLowerCase();
    list.replaceChildren();
    for (const [label, detail] of COMMAND_SUGGESTIONS.filter(
      ([label, detail]) =>
        !query || `${label} ${detail}`.toLowerCase().includes(query),
    )) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'agent-os-command-option';
      option.setAttribute('role', 'option');
      const title = document.createElement('span');
      title.textContent = label;
      const description = document.createElement('small');
      description.textContent = detail;
      option.append(title, description);
      option.addEventListener('click', () => {
        input.value = label;
        setOpen(false);
        form.requestSubmit();
      });
      list.appendChild(option);
    }
  };

  const executePrompt = async (prompt) => {
    const text = String(prompt || '').trim();
    if (!text) return;
    setOpen(false);
    status.dataset.state = 'working';
    status.textContent = 'Running command…';
    submit.disabled = true;
    try {
      if (window.parent !== window) {
        const parentOrigin = new URL(document.referrer || window.location.href)
          .origin;
        if (!isTrustedAgentOsOrigin(parentOrigin)) {
          throw new Error('Agent OS parent origin is not trusted');
        }
        window.parent.postMessage(
          { type: MESSAGE_TYPE, kind: 'prompt', prompt: text },
          parentOrigin,
        );
        status.textContent = 'Sent to Agent OS';
        return;
      }
      const commands = inferCommands(text);
      if (!commands.length) {
        commands.push({
          name: 'fly_to_location',
          arguments: { query: text, viewMode: 'overview' },
        });
      }
      await runCommands(commands);
      status.dataset.state = 'ready';
      status.textContent = 'Done';
      input.select();
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error?.message || String(error);
    } finally {
      submit.disabled = false;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void executePrompt(input.value);
  });
  input.addEventListener('focus', () => {
    renderSuggestions();
    setOpen(true);
  });
  input.addEventListener('input', renderSuggestions);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setLayersOpen(false);
      input.blur();
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) {
      setOpen(false);
      setLayersOpen(false);
    }
  });
  layerTrigger.addEventListener('click', () => {
    setLayersOpen(!root.classList.contains('is-layers-open'));
  });

  root.append(list, layerPopover, form, status);
  document.body.appendChild(root);
  void application
    .start()
    .then(({ scene }) => {
      const controller = scene?.mapStackController;
      reliefProvider = scene?.viewer?.terrainProvider || null;
      const stacks = new Map(
        (controller?.getStacks?.() || []).map((stack) => [stack.id, stack]),
      );
      for (const [terrainId, button] of terrainButtons) {
        if (terrainId === 'flat') continue;
        const stack = stacks.get(terrainId);
        button.disabled = stack?.available === false;
        if (stack?.unavailableReason) button.title = stack.unavailableReason;
      }
      markTerrainSelection(controller?.getActiveId?.() || 'mapbox');
    })
    .catch(() => {});
  window.addEventListener('gev:map-stack-changed', (event) => {
    if (!reliefEnabled || event.detail?.status !== 'ready') return;
    markTerrainSelection(event.detail.activeId);
  });
  return { status };
}

/** Bridge Agent OS capability calls to the same runner used by upstream voice AI. */
export function installAgentOsBridge(application) {
  document.documentElement.dataset.agentOsEmbedded = 'true';
  replaceEmbeddedIcons();
  const commandPalette = installCommandPalette(application);

  application
    .start()
    .then(async ({ scene, tools }) => {
      setScopeMaskEnabled(false);
      configureNaturalMapNavigation(scene.viewer);
      configureEmbeddedRendering(scene.viewer);
      await tools.voiceCommands?.runAction?.(
        'set_post_processing',
        {
          bloom: { enabled: false },
          sharpen: { enabled: false },
        },
        { isCurrent: () => true },
      );
    })
    .catch(() => {});

  const respond = (event, payload) => {
    event.source?.postMessage?.(
      { type: MESSAGE_TYPE, ...payload },
      event.origin,
    );
  };

  const onMessage = async (event) => {
    if (
      !isTrustedAgentOsOrigin(event.origin) ||
      event.data?.type !== MESSAGE_TYPE
    )
      return;
    if (event.data.kind === 'prompt') return;
    const requestId = String(event.data.requestId || '');
    try {
      const components = await application.start();
      const runAction = components.tools?.voiceCommands?.runAction;
      if (typeof runAction !== 'function') {
        throw new Error("God's Eye View action runner is not ready");
      }
      const results = [];
      for (const command of event.data.commands || []) {
        results.push(
          await runAction(command.name, command.arguments || {}, {
            isCurrent: () => true,
          }),
        );
      }
      commandPalette.status.dataset.state = 'ready';
      commandPalette.status.textContent = 'Done';
      respond(event, { requestId, ok: true, results });
    } catch (error) {
      commandPalette.status.dataset.state = 'error';
      commandPalette.status.textContent = error?.message || String(error);
      respond(event, {
        requestId,
        ok: false,
        error: error?.message || String(error),
      });
    }
  };

  window.addEventListener('message', onMessage);
  application.subscribe((state) => {
    if (state.status === 'destroyed') {
      window.removeEventListener('message', onMessage);
    }
  });
}
