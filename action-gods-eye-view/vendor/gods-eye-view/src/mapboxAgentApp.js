import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createMapboxCameraLayer } from './mapboxCameras.js';

const MESSAGE_TYPE = 'agent-os:gods-eye-view';
const DEM_SOURCE_ID = 'agent-os-mapbox-dem';

const SURFACES = [
  {
    id: 'satellite',
    label: 'Satellite 3D',
    detail: 'Mapbox imagery',
    style: 'mapbox://styles/mapbox/standard-satellite',
    icon: 'mountain',
  },
  {
    id: 'standard',
    label: 'Standard 3D',
    detail: 'Night lighting',
    style: 'mapbox://styles/mapbox/standard',
    icon: 'buildings',
  },
  {
    id: 'outdoors',
    label: 'Outdoors 3D',
    detail: 'Terrain detail',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    icon: 'map',
  },
  {
    id: 'flat',
    label: 'Flat map',
    detail: 'Terrain disabled',
    style: null,
    icon: 'circle',
  },
];

const DATA_LAYERS = [
  { id: 'cctv', icon: 'camera', label: 'Cameras', ready: true },
  { id: 'flights', icon: 'plane', label: 'Flights' },
  { id: 'military', icon: 'shield', label: 'Military' },
  { id: 'vessels', icon: 'ship', label: 'Vessels' },
  { id: 'satellites', icon: 'satellite', label: 'Satellites' },
  { id: 'traffic', icon: 'car', label: 'Traffic' },
  { id: 'earthquakes', icon: 'activity', label: 'Earthquakes' },
  { id: 'wildfires', icon: 'flame', label: 'Wildfires' },
];

const ICONS = {
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
  mouse: [
    ['rect', { x: 5, y: 2, width: 14, height: 20, rx: 7 }],
    ['path', { d: 'M12 2v6' }],
  ],
  arrowUp: [['path', { d: 'm18 15-6-6-6 6' }]],
  arrowDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  arrowLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
  arrowRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  rotateCcw: [
    ['path', { d: 'M3 12a9 9 0 1 0 3-6.7L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  rotateCw: [
    ['path', { d: 'M21 12a9 9 0 1 1-3-6.7L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  tiltUp: [
    ['path', { d: 'm12 3 5 5H7Z' }],
    ['path', { d: 'M5 14h14M7 18h10M9 22h6' }],
  ],
  tiltDown: [
    ['path', { d: 'm12 21-5-5h10Z' }],
    ['path', { d: 'M5 10h14M7 6h10M9 2h6' }],
  ],
  reset: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'm12 7 3 5-3 5-3-5Z' }],
  ],
  mountain: [
    ['path', { d: 'm8 3 4 8 2-3 7 13H3Z' }],
    ['path', { d: 'm8 3 3 6-2 2-2-2-4 12' }],
  ],
  buildings: [
    ['path', { d: 'M3 21V8l6-3v16m0-9 6-3v12m0-15 6 3v12' }],
    [
      'path',
      { d: 'M6 11h.01M6 15h.01M12 14h.01M12 18h.01M18 12h.01M18 16h.01' },
    ],
  ],
  map: [
    ['path', { d: 'M14.5 4.5 9.5 2 3 5.5v16L9.5 18l5 2.5 6.5-3.5V1Z' }],
    ['path', { d: 'M9.5 2v16m5-13.5v16' }],
  ],
  circle: [['circle', { cx: 12, cy: 12, r: 9 }]],
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
  ],
  satellite: [
    ['path', { d: 'm13 7 4 4-6 6-4-4Z' }],
    ['path', { d: 'm17 3 4 4-3 3-4-4Zm-7 11-4 4-3-3 4-4Zm9 5-3-3m-8-8L5 5' }],
  ],
  car: [
    ['path', { d: 'M3 11l2-5h14l2 5v7H3Z' }],
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
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('lucide');
  for (const [tag, attributes] of ICONS[name] || []) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, value);
    }
    svg.append(node);
  }
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function initialCamera() {
  const params = new URLSearchParams(location.hash.slice(1));
  const longitude = Number(params.get('lon'));
  const latitude = Number(params.get('lat'));
  const altitude = Number(params.get('alt'));
  const heading = Number(params.get('heading'));
  const cesiumPitch = Number(params.get('pitch'));
  return {
    center: [
      Number.isFinite(longitude) ? longitude : 12.243,
      Number.isFinite(latitude) ? latitude : 45.6669,
    ],
    zoom: Number.isFinite(altitude)
      ? Math.max(
          1,
          Math.min(18, Math.log2(40075016 / Math.max(altitude, 30)) - 1.7),
        )
      : 12,
    bearing: Number.isFinite(heading) ? heading % 360 : 0,
    pitch: Number.isFinite(cesiumPitch)
      ? Math.max(0, Math.min(80, 90 + cesiumPitch))
      : 58,
  };
}

function trustedOrigin(origin) {
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

function placeFromPrompt(prompt) {
  const text = String(prompt || '').trim();
  const match = text.match(
    /\b(?:at|in|near|over|around|to|a|su|vicino)\s+(.+?)(?:\s+(?:with|and|con|e)\s+|$)/i,
  );
  return (match?.[1] || text)
    .replace(
      /\b(?:occhio di dio|show|give me|mostrami|apri|camera(?:s)?|cctv|flight(?:s)?|terrain|map)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function installCameraNavigation(map) {
  const root = element('aside', 'agent-os-view-control');
  const trigger = element('button', 'agent-os-view-trigger');
  trigger.type = 'button';
  trigger.title = 'Camera movement';
  trigger.setAttribute('aria-label', 'Open camera movement controls');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.append(icon('mouse'));
  const panel = element('div', 'agent-os-view-panel');
  const heading = element('strong', '', 'Move view');
  const hint = element(
    'span',
    '',
    'Drag to pan · right-drag to orbit · scroll to zoom',
  );
  const buttons = element('div', 'agent-os-view-buttons');
  const actions = [
    ['arrowLeft', 'Pan left', () => map.panBy([-140, 0])],
    ['arrowUp', 'Pan up', () => map.panBy([0, -110])],
    ['arrowDown', 'Pan down', () => map.panBy([0, 110])],
    ['arrowRight', 'Pan right', () => map.panBy([140, 0])],
    [
      'rotateCcw',
      'Rotate left',
      () => map.easeTo({ bearing: map.getBearing() - 18, duration: 280 }),
    ],
    [
      'rotateCw',
      'Rotate right',
      () => map.easeTo({ bearing: map.getBearing() + 18, duration: 280 }),
    ],
    [
      'tiltDown',
      'Lower camera',
      () =>
        map.easeTo({
          pitch: Math.max(0, map.getPitch() - 10),
          duration: 280,
        }),
    ],
    [
      'tiltUp',
      'Raise camera',
      () =>
        map.easeTo({
          pitch: Math.min(85, map.getPitch() + 10),
          duration: 280,
        }),
    ],
  ];
  for (const [iconName, label, action] of actions) {
    const button = element('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(iconName));
    button.addEventListener('click', action);
    buttons.append(button);
  }
  const reset = element('button', 'agent-os-view-reset');
  reset.type = 'button';
  reset.append(icon('reset'), document.createTextNode('Reset angle'));
  reset.addEventListener('click', () => {
    map.easeTo({ bearing: 0, pitch: 58, duration: 420 });
  });
  panel.append(heading, hint, buttons, reset);
  root.append(trigger, panel);
  trigger.addEventListener('click', () => {
    const open = !root.classList.contains('is-open');
    root.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) {
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  document.body.append(root);
  return root;
}

export function installMapboxAgentApp({ accessToken, mapboxStyle } = {}) {
  document.documentElement.dataset.agentOsEmbedded = 'true';
  document.documentElement.dataset.mapRenderer = 'mapbox';
  document.body.replaceChildren();

  const mapRoot = element('main', 'agent-os-mapbox-map');
  mapRoot.id = 'agent-os-mapbox-map';
  const command = element('section', 'agent-os-mapbox-command');
  command.setAttribute('aria-label', "God's Eye command bar");
  const popover = element('div', 'agent-os-mapbox-popover');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Terrain and data layers');
  const heading = element('div', 'agent-os-mapbox-heading');
  heading.append(
    element('strong', '', 'Terrain & layers'),
    element('span', '', 'Mapbox-native surface controls'),
  );
  const terrainLabel = element('p', 'agent-os-mapbox-section-label', 'Terrain');
  const terrainGrid = element('div', 'agent-os-mapbox-grid');
  const layerLabel = element(
    'p',
    'agent-os-mapbox-section-label',
    'Data layers',
  );
  const layerGrid = element('div', 'agent-os-mapbox-grid');
  popover.append(heading, terrainLabel, terrainGrid, layerLabel, layerGrid);

  const form = element('form', 'agent-os-mapbox-form');
  const searchIcon = element('span', 'agent-os-mapbox-search-icon');
  searchIcon.append(icon('search'));
  const input = element('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = 'Ask about a place…';
  input.setAttribute('aria-label', "Ask God's Eye View");
  const shortcut = element('kbd', '', '⌘K');
  const layerTrigger = element('button', 'agent-os-mapbox-layer-trigger');
  layerTrigger.type = 'button';
  layerTrigger.setAttribute('aria-label', 'Choose terrain and layers');
  layerTrigger.setAttribute('aria-expanded', 'false');
  layerTrigger.append(icon('layers'));
  const submit = element('button', '', 'Go');
  submit.type = 'submit';
  form.append(searchIcon, input, shortcut, layerTrigger, submit);
  const status = element('p', 'agent-os-mapbox-status', 'Loading Mapbox…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  command.append(popover, form, status);
  document.body.append(mapRoot, command);

  const token = String(accessToken || '').trim();
  if (!token) {
    status.dataset.state = 'error';
    status.textContent = 'MAPBOX_ACCESS_TOKEN is missing';
    return null;
  }

  const surfaceButtons = new Map();
  let activeSurface = 'satellite';
  let terrainEnabled = true;
  let geocodeController = null;
  const configuredStyle = String(mapboxStyle || '').trim();
  if (configuredStyle && configuredStyle !== 'mapbox/satellite-streets-v12') {
    SURFACES[0].style = configuredStyle.startsWith('mapbox://')
      ? configuredStyle
      : `mapbox://styles/${configuredStyle}`;
  }

  mapboxgl.accessToken = token;
  const map = new mapboxgl.Map({
    accessToken: token,
    container: mapRoot,
    style: SURFACES[0].style,
    projection: 'globe',
    ...initialCamera(),
    antialias: true,
    maxPitch: 85,
    fadeDuration: 120,
  });
  map.addControl(
    new mapboxgl.NavigationControl({ visualizePitch: true }),
    'top-right',
  );
  installCameraNavigation(map);

  let cameraMeta = null;
  const cameraLayer = createMapboxCameraLayer({
    map,
    status,
    onCount(visible, total) {
      if (!cameraMeta) return;
      cameraMeta.textContent = cameraLayer.isEnabled()
        ? visible
          ? `${visible} nearby`
          : 'No cameras here'
        : total
          ? `${total.toLocaleString()} available`
          : 'Ready';
      if (cameraLayer.isEnabled()) {
        status.dataset.state = 'ready';
        status.textContent = visible
          ? `${visible} cameras in view`
          : 'No catalog cameras in this view';
      }
    },
  });

  const markSurface = (id) => {
    for (const [surfaceId, button] of surfaceButtons) {
      button.setAttribute('aria-pressed', String(surfaceId === id));
    }
  };

  const installTerrain = () => {
    if (!terrainEnabled) return;
    if (!map.getSource(DEM_SOURCE_ID)) {
      map.addSource(DEM_SOURCE_ID, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 1.15 });
    const nightMode = activeSurface === 'standard';
    try {
      map.setFog({
        range: [0.7, 8],
        color: nightMode ? '#17212b' : '#c8d3d4',
        'high-color': nightMode ? '#0d1825' : '#8ea8b2',
        'space-color': nightMode ? '#020309' : '#07090c',
        'star-intensity': nightMode ? 0.5 : 0.12,
      });
      map.setConfigProperty('basemap', 'show3dObjects', true);
      map.setConfigProperty(
        'basemap',
        'lightPreset',
        nightMode ? 'night' : 'day',
      );
    } catch {
      // Classic styles do not expose Standard style configuration.
    }
  };

  const setSurface = (id) => {
    const surface = SURFACES.find((item) => item.id === id);
    if (!surface) return;
    if (id === 'flat') {
      terrainEnabled = false;
      map.setTerrain(null);
      activeSurface = id;
      markSurface(id);
      status.textContent = 'Flat map ready';
      return;
    }
    terrainEnabled = true;
    activeSurface = id;
    map.setStyle(surface.style);
    markSurface(id);
    status.textContent = `Loading ${surface.label.toLowerCase()}…`;
  };

  for (const surface of SURFACES) {
    const button = element('button', 'agent-os-mapbox-option');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.append(icon(surface.icon));
    const copy = element('span');
    copy.append(
      element('b', '', surface.label),
      element('small', '', surface.detail),
    );
    const dot = element('i');
    dot.setAttribute('aria-hidden', 'true');
    button.append(copy, dot);
    button.addEventListener('click', () => setSurface(surface.id));
    surfaceButtons.set(surface.id, button);
    terrainGrid.append(button);
  }
  markSurface(activeSurface);

  for (const layer of DATA_LAYERS) {
    const button = element(
      'button',
      `agent-os-mapbox-option${layer.ready ? '' : ' is-planned'}`,
    );
    button.type = 'button';
    if (layer.ready) button.setAttribute('aria-pressed', 'false');
    const meta = element('small', '', layer.ready ? 'Ready' : 'Soon');
    button.append(icon(layer.icon), element('span', '', layer.label), meta);
    if (layer.id === 'cctv') cameraMeta = meta;
    button.addEventListener('click', async () => {
      if (!layer.ready) {
        status.textContent = `${layer.label} will be migrated to Mapbox next`;
        return;
      }
      button.disabled = true;
      try {
        const nextEnabled = !cameraLayer.isEnabled();
        const state = await cameraLayer.setEnabled(nextEnabled);
        button.setAttribute('aria-pressed', String(state.enabled));
        status.dataset.state = 'ready';
        status.textContent = state.enabled
          ? state.visible
            ? `${state.visible} cameras visible`
            : 'No catalog cameras in this view'
          : 'Cameras hidden';
      } catch (error) {
        status.dataset.state = 'error';
        status.textContent = error?.message || String(error);
      } finally {
        button.disabled = false;
      }
    });
    layerGrid.append(button);
  }

  const geocode = async (query) => {
    const cleanQuery = placeFromPrompt(query);
    if (!cleanQuery) throw new Error('Enter a place to search');
    geocodeController?.abort();
    geocodeController = new AbortController();
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', cleanQuery);
    url.searchParams.set('limit', '1');
    url.searchParams.set('access_token', token);
    const response = await fetch(url, { signal: geocodeController.signal });
    if (!response.ok)
      throw new Error(`Mapbox search failed (${response.status})`);
    const result = await response.json();
    const feature = result.features?.[0];
    if (!feature) throw new Error(`No result for ${cleanQuery}`);
    if (feature.bbox?.length === 4) {
      map.fitBounds(
        [
          [feature.bbox[0], feature.bbox[1]],
          [feature.bbox[2], feature.bbox[3]],
        ],
        { padding: 90, pitch: 58, duration: 1100 },
      );
    } else {
      map.flyTo({
        center: feature.geometry.coordinates,
        zoom: 13.5,
        pitch: 58,
        duration: 1100,
        essential: true,
      });
    }
    return (
      feature.properties?.full_address || feature.properties?.name || cleanQuery
    );
  };

  const runPrompt = async (prompt) => {
    const text = String(prompt || '').trim();
    if (!text) return;
    command.classList.remove('is-open');
    layerTrigger.setAttribute('aria-expanded', 'false');
    submit.disabled = true;
    status.dataset.state = 'working';
    status.textContent = 'Searching Mapbox…';
    try {
      const lower = text.toLowerCase();
      const wantsCameras = /\b(?:camera|cameras|cctv)\b/.test(lower);
      if (/\b(?:flat|2d)\b/.test(lower)) setSurface('flat');
      else if (/\boutdoor|topograph/.test(lower)) setSurface('outdoors');
      else if (/\b(?:street|standard|night)\b/.test(lower))
        setSurface('standard');
      else if (/\b(?:satellite|mapbox|3d)\b/.test(lower))
        setSurface('satellite');
      if (wantsCameras) {
        await cameraLayer.setEnabled(true);
        cameraMeta?.closest('button')?.setAttribute('aria-pressed', 'true');
      }
      const place = placeFromPrompt(text);
      if (
        place &&
        !/^(?:flat|2d|3d|satellite|mapbox|terrain|standard|streets?|night)$/i.test(
          place,
        )
      ) {
        const label = await geocode(place);
        status.textContent = `${label} · Mapbox 3D`;
      } else {
        status.textContent = `${SURFACES.find((item) => item.id === activeSurface)?.label || 'Map'} ready`;
      }
      status.dataset.state = 'ready';
    } catch (error) {
      if (error?.name !== 'AbortError') {
        status.dataset.state = 'error';
        status.textContent = error?.message || String(error);
      }
    } finally {
      submit.disabled = false;
    }
  };

  const executeCommand = async (commandItem) => {
    const args = commandItem.arguments || {};
    switch (commandItem.name) {
      case 'fly_to_location':
        if (Number.isFinite(args.longitude) && Number.isFinite(args.latitude)) {
          map.flyTo({
            center: [args.longitude, args.latitude],
            zoom: 13.5,
            pitch: 58,
            duration: 1100,
            essential: true,
          });
          return { ok: true };
        }
        await geocode(args.query || '');
        return { ok: true };
      case 'zoom_to_globe':
        map.flyTo({
          center: [0, 20],
          zoom: 1.2,
          pitch: 0,
          bearing: 0,
          duration: 900,
        });
        return { ok: true };
      case 'adjust_camera_zoom':
        map.easeTo({
          zoom: map.getZoom() + (args.direction === 'out' ? -1.5 : 1.5),
          duration: 450,
        });
        return { ok: true };
      case 'set_map_stack':
        setSurface(args.stack === 'osm' ? 'standard' : 'satellite');
        return { ok: true };
      case 'set_layer_visibility':
        if (args.layerId === 'cctv' || args.layerId === 'cameras') {
          const state = await cameraLayer.setEnabled(args.enabled !== false);
          cameraMeta
            ?.closest('button')
            ?.setAttribute('aria-pressed', String(state.enabled));
          return { ok: true, ...state };
        }
        status.textContent = 'This data layer is queued for Mapbox migration';
        return { ok: true, pendingMigration: true };
      default:
        return { ok: true, ignoredDuringMigration: true };
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void runPrompt(input.value);
  });
  layerTrigger.addEventListener('click', () => {
    const open = !command.classList.contains('is-open');
    command.classList.toggle('is-open', open);
    layerTrigger.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!command.contains(event.target)) {
      command.classList.remove('is-open');
      layerTrigger.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
      input.select();
    }
    if (event.key === 'Escape') {
      command.classList.remove('is-open');
      layerTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  map.on('style.load', () => {
    installTerrain();
    cameraLayer.install();
    status.dataset.state = 'ready';
    status.textContent = `${SURFACES.find((item) => item.id === activeSurface)?.label || 'Map'} ready`;
  });
  map.on('error', (event) => {
    const message = String(
      event.error?.message || 'Mapbox could not load this tile',
    );
    if (/abort/i.test(message)) return;
    status.dataset.state = 'error';
    status.textContent = message;
  });

  window.addEventListener('message', async (event) => {
    if (!trustedOrigin(event.origin) || event.data?.type !== MESSAGE_TYPE)
      return;
    if (event.data.kind === 'prompt') return;
    const requestId = String(event.data.requestId || '');
    try {
      const results = [];
      for (const commandItem of event.data.commands || []) {
        results.push(await executeCommand(commandItem));
      }
      event.source?.postMessage?.(
        { type: MESSAGE_TYPE, requestId, ok: true, results },
        event.origin,
      );
    } catch (error) {
      event.source?.postMessage?.(
        {
          type: MESSAGE_TYPE,
          requestId,
          ok: false,
          error: error?.message || String(error),
        },
        event.origin,
      );
    }
  });

  window.__agentOsMapbox = { map, setSurface, executeCommand };
  return map;
}
