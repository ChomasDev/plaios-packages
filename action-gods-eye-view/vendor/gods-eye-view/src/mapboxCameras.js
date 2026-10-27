import { isVideoFeedType, normalizeFeedType } from './sources/cctvTypes.js';

const SOURCE_ID = 'agent-os-cameras';
const VIEW_SOURCE_ID = 'agent-os-camera-view';
const GLOW_LAYER_ID = 'agent-os-camera-glow';
const HALO_LAYER_ID = 'agent-os-camera-halos';
const MODEL_LAYER_ID = 'agent-os-camera-models';
const RED_LIGHT_LAYER_ID = 'agent-os-red-light-models';
const VIEW_LAYER_ID = 'agent-os-camera-view-volume';
const VIEW_EDGE_LAYER_ID = 'agent-os-camera-view-edge';
const POLE_LAYER_ID = 'agent-os-camera-poles';
const SELECTED_LAYER_ID = 'agent-os-camera-selected';
const MODEL_ID = 'poly-pizza-security-camera';
const MODEL_URI = '/models/poly-pizza-security-camera.glb';
const RED_LIGHT_MODEL_ID = 'poly-pizza-traffic-light';
const RED_LIGHT_MODEL_URI = '/models/poly-pizza-traffic-light.glb';
const POLE_MODEL_ID = 'agent-os-camera-pole';
const POLE_MODEL_URI = '/models/agent-os-camera-pole.glb';
const GLOW_IMAGE_ID = 'agent-os-camera-xray';
const RED_GLOW_IMAGE_ID = 'agent-os-red-light-xray';
const EMPTY_COLLECTION = Object.freeze({
  type: 'FeatureCollection',
  features: [],
});

function cameraFeatures(cameras) {
  return {
    type: 'FeatureCollection',
    features: cameras.map((camera) => ({
      type: 'Feature',
      id: camera.id,
      properties: {
        id: camera.id,
        name: camera.name,
        provider: camera.provider,
        city: camera.city,
        heading: camera.headingDeg,
        headingBucket: (Math.round(camera.headingDeg / 45) * 45) % 360,
        feedType: camera.feedType,
        kind: camera.kind,
        mountType: camera.mountType,
        mountHeight: camera.mountHeight,
        model: camera.kind === 'red-light' ? RED_LIGHT_MODEL_ID : MODEL_ID,
      },
      geometry: {
        type: 'Point',
        coordinates: [
          camera.renderLon ?? camera.lon,
          camera.renderLat ?? camera.lat,
        ],
      },
    })),
  };
}

function cameraKind(camera) {
  const description = [
    camera.name,
    camera.type,
    camera.cameraType,
    camera.category,
    camera.description,
  ]
    .filter(Boolean)
    .join(' ');
  return /\b(?:red[ -]?light|traffic[ -]?signal|signal enforcement)\b/i.test(
    description,
  )
    ? 'red-light'
    : 'camera';
}

function geometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates || [];
  if (geometry?.type === 'MultiPolygon') {
    return (geometry.coordinates || []).flat();
  }
  return [];
}

function destination([lon, lat], bearingDeg, distanceM) {
  const radiusM = 6_371_008.8;
  const bearing = (bearingDeg * Math.PI) / 180;
  const latitude = (lat * Math.PI) / 180;
  const longitude = (lon * Math.PI) / 180;
  const angularDistance = distanceM / radiusM;
  const nextLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude),
    );
  return [(nextLongitude * 180) / Math.PI, (nextLatitude * 180) / Math.PI];
}

function bearingBetween([startLon, startLat], [endLon, endLat]) {
  const start = (startLat * Math.PI) / 180;
  const end = (endLat * Math.PI) / 180;
  const delta = ((endLon - startLon) * Math.PI) / 180;
  const y = Math.sin(delta) * Math.cos(end);
  const x =
    Math.cos(start) * Math.sin(end) -
    Math.sin(start) * Math.cos(end) * Math.cos(delta);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function closestPointOnRing(map, point, ring) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    const a = map.project(start);
    const b = map.project(end);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          ),
        )
      : 0;
    const candidate = {
      x: a.x + dx * amount,
      y: a.y + dy * amount,
    };
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = [
        start[0] + (end[0] - start[0]) * amount,
        start[1] + (end[1] - start[1]) * amount,
      ];
    }
  }
  return { coordinate: closest, distance: closestDistance };
}

function buildingHeight(feature) {
  for (const key of [
    'height',
    'render_height',
    'building_height',
    'roof_height',
  ]) {
    const value = Number(feature.properties?.[key]);
    if (Number.isFinite(value) && value > 2) return value;
  }
  return 7;
}

function mountHeightBucket(height) {
  const value = Math.min(12, Math.max(3, Number(height) || 3));
  return [3, 4, 5, 6, 8, 10, 12].reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value)
      ? candidate
      : nearest,
  );
}

function viewFeature(camera) {
  if (!camera) return EMPTY_COLLECTION;
  const origin = [
    camera.renderLon ?? camera.lon,
    camera.renderLat ?? camera.lat,
  ];
  const rangeM = Math.min(180, Math.max(55, Number(camera.rangeM) || 110));
  const fovDeg = Math.min(90, Math.max(30, Number(camera.fovDeg) || 58));
  const arc = [];
  for (let step = 0; step <= 8; step += 1) {
    const bearing = camera.headingDeg - fovDeg / 2 + (fovDeg * step) / 8;
    arc.push(destination(origin, bearing, rangeM));
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: camera.kind },
        geometry: { type: 'Polygon', coordinates: [[origin, ...arc, origin]] },
      },
    ],
  };
}

const ROTATION_BY_HEADING = [
  'match',
  ['get', 'headingBucket'],
  45,
  ['literal', [0, 0, 45]],
  90,
  ['literal', [0, 0, 90]],
  135,
  ['literal', [0, 0, 135]],
  180,
  ['literal', [0, 0, 180]],
  225,
  ['literal', [0, 0, 225]],
  270,
  ['literal', [0, 0, 270]],
  315,
  ['literal', [0, 0, 315]],
  ['literal', [0, 0, 0]],
];

const TRANSLATION_BY_MOUNT = [
  'match',
  ['get', 'mountHeight'],
  4,
  ['literal', [0, 0, 4]],
  5,
  ['literal', [0, 0, 5]],
  6,
  ['literal', [0, 0, 6]],
  8,
  ['literal', [0, 0, 8]],
  10,
  ['literal', [0, 0, 10]],
  12,
  ['literal', [0, 0, 12]],
  ['literal', [0, 0, 3]],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function xIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  first.setAttribute('d', 'M18 6 6 18');
  second.setAttribute('d', 'm6 6 12 12');
  svg.append(first, second);
  return svg;
}

function fullscreenIcon(active = false) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const paths = active
    ? [
        'M8 3v3a2 2 0 0 1-2 2H3',
        'M16 3v3a2 2 0 0 0 2 2h3',
        'M8 21v-3a2 2 0 0 0-2-2H3',
        'M16 21v-3a2 2 0 0 1 2-2h3',
      ]
    : [
        'M8 3H5a2 2 0 0 0-2 2v3',
        'M16 3h3a2 2 0 0 1 2 2v3',
        'M8 21H5a2 2 0 0 1-2-2v-3',
        'M16 21h3a2 2 0 0 0 2-2v-3',
      ];
  for (const definition of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', definition);
    svg.append(path);
  }
  return svg;
}

function glowImage(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 6, 32, 32, 30);
  gradient.addColorStop(0, `${color}00`);
  gradient.addColorStop(0.38, `${color}18`);
  gradient.addColorStop(0.68, `${color}70`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  context.beginPath();
  context.arc(32, 32, 15, 0, Math.PI * 2);
  context.strokeStyle = `${color}f2`;
  context.lineWidth = 2.5;
  context.stroke();
  return context.getImageData(0, 0, 64, 64);
}

function ensureGlowImages(map) {
  if (!map.hasImage(GLOW_IMAGE_ID)) {
    map.addImage(GLOW_IMAGE_ID, glowImage('#8df7f8'), { pixelRatio: 2 });
  }
  if (!map.hasImage(RED_GLOW_IMAGE_ID)) {
    map.addImage(RED_GLOW_IMAGE_ID, glowImage('#ff6b64'), { pixelRatio: 2 });
  }
}

function createCameraSidebar() {
  const root = element('aside', 'agent-os-camera-sidebar');
  root.setAttribute('aria-label', 'Selected camera feed');
  root.setAttribute('aria-hidden', 'true');

  const header = element('header', 'agent-os-camera-sidebar-header');
  const headerCopy = element('div');
  const live = element('span', 'agent-os-camera-live', 'Live camera');
  const title = element('h2', '', 'Select a camera');
  const close = element('button', 'agent-os-camera-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close camera feed');
  close.append(xIcon());
  headerCopy.append(live, title);
  const headerActions = element('div', 'agent-os-camera-header-actions');
  const fullscreen = element('button', 'agent-os-camera-fullscreen');
  fullscreen.type = 'button';
  fullscreen.setAttribute('aria-label', 'View live feed full screen');
  fullscreen.append(fullscreenIcon());
  headerActions.append(fullscreen, close);
  header.append(headerCopy, headerActions);

  const media = element('div', 'agent-os-camera-media');
  const frame = document.createElement('img');
  frame.alt = '';
  frame.loading = 'eager';
  const video = document.createElement('video');
  video.hidden = true;
  video.autoplay = true;
  video.controls = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const frameState = element(
    'p',
    'agent-os-camera-frame-state',
    'Loading frame…',
  );
  media.append(frame, video, frameState);

  const details = element('dl', 'agent-os-camera-details');
  const fields = new Map();
  for (const [key, label] of [
    ['provider', 'Source'],
    ['area', 'Area'],
    ['feed', 'Feed'],
    ['heading', 'Direction'],
  ]) {
    const group = element('div');
    group.append(element('dt', '', label));
    const value = element('dd', '', '—');
    group.append(value);
    fields.set(key, value);
    details.append(group);
  }

  const aim = element('div', 'agent-os-camera-aim');
  const aimHeader = element('div');
  const aimLabel = element('label', '', 'Aim camera');
  aimLabel.htmlFor = 'agent-os-camera-heading';
  const aimValue = element('output', '', '0°');
  aimValue.htmlFor = 'agent-os-camera-heading';
  aimHeader.append(aimLabel, aimValue);
  const aimControls = element('div');
  const aimLeft = element('button', '', '−45°');
  aimLeft.type = 'button';
  aimLeft.setAttribute('aria-label', 'Rotate camera 45 degrees left');
  const aimInput = document.createElement('input');
  aimInput.id = 'agent-os-camera-heading';
  aimInput.type = 'range';
  aimInput.min = '0';
  aimInput.max = '355';
  aimInput.step = '5';
  aimInput.setAttribute('aria-label', 'Camera heading');
  const aimRight = element('button', '', '+45°');
  aimRight.type = 'button';
  aimRight.setAttribute('aria-label', 'Rotate camera 45 degrees right');
  aimControls.append(aimLeft, aimInput, aimRight);
  aim.append(aimHeader, aimControls);

  const footer = element('footer', 'agent-os-camera-sidebar-footer');
  const refresh = element('button', '', 'Refresh frame');
  refresh.type = 'button';
  const note = element('span', '', 'Refreshes every 7 seconds');
  footer.append(refresh, note);

  root.append(header, media, details, aim, footer);
  document.body.append(root);
  return {
    root,
    live,
    title,
    close,
    fullscreen,
    media,
    frame,
    video,
    frameState,
    fields,
    aimInput,
    aimValue,
    aimLeft,
    aimRight,
    refresh,
    note,
  };
}

/** Mapbox-native CCTV layer backed by the existing normalized camera service. */
export function createMapboxCameraLayer({ map, status, onCount = () => {} }) {
  let enabled = false;
  let catalog = null;
  let catalogPromise = null;
  let visibleCameras = [];
  let modelRegistered = false;
  let selectedCamera = null;
  let refreshTimer = null;
  const sidebar = createCameraSidebar();
  const buildingAnchors = new Map();
  const headingOverrides = new Map();
  const videoFallbacks = new Set();

  const attachToNearestBuilding = (camera) => {
    if (camera.kind === 'red-light') {
      return { ...camera, mountType: 'standalone', mountHeight: 0 };
    }
    const poleMount = {
      renderLon: camera.lon,
      renderLat: camera.lat,
      mountType: 'pole',
      mountHeight: 3,
    };
    if (map.getZoom() < 16) return { ...camera, ...poleMount };
    const cached = buildingAnchors.get(camera.id);
    if (cached) return { ...camera, ...cached };
    const point = map.project([camera.lon, camera.lat]);
    const metersPerPixel =
      (156_543.03392 * Math.cos((camera.lat * Math.PI) / 180)) /
      2 ** map.getZoom();
    const radius = Math.min(140, Math.max(12, 18 / metersPerPixel));
    const features = map.queryRenderedFeatures([
      [point.x - radius, point.y - radius],
      [point.x + radius, point.y + radius],
    ]);
    let closest = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestBuildingHeight = 7;
    for (const feature of features) {
      const layerName = `${feature.layer?.id || ''} ${feature.layer?.['source-layer'] || ''}`;
      if (
        feature.layer?.type !== 'fill-extrusion' &&
        !/building/i.test(layerName)
      ) {
        continue;
      }
      for (const ring of geometryRings(feature.geometry)) {
        const candidate = closestPointOnRing(map, point, ring);
        if (candidate.coordinate && candidate.distance < closestDistance) {
          closestDistance = candidate.distance;
          closest = candidate.coordinate;
          closestBuildingHeight = buildingHeight(feature);
        }
      }
    }
    if (!closest || closestDistance > radius)
      return { ...camera, ...poleMount };
    const outsideBearing = bearingBetween(closest, [camera.lon, camera.lat]);
    const outside = destination(closest, outsideBearing, 0.38);
    const anchor = {
      renderLon: outside[0],
      renderLat: outside[1],
      mountType: 'building-wall',
      mountHeight: mountHeightBucket(closestBuildingHeight * 0.62),
    };
    buildingAnchors.set(camera.id, anchor);
    return { ...camera, ...anchor };
  };

  const snapshotRefreshMs = () =>
    sidebar.root.classList.contains('is-fullscreen') ? 2_500 : 7_000;

  const selectedFeedIsVideo = () =>
    Boolean(
      selectedCamera &&
      isVideoFeedType(normalizeFeedType(selectedCamera.feedType)) &&
      !videoFallbacks.has(selectedCamera.id),
    );

  const clearRefreshTimer = () => {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const scheduleSnapshotRefresh = () => {
    clearRefreshTimer();
    if (!selectedCamera || selectedFeedIsVideo()) return;
    refreshTimer = setTimeout(loadSelectedFrame, snapshotRefreshMs());
  };

  const stopSelectedMedia = () => {
    clearRefreshTimer();
    sidebar.frame.removeAttribute('src');
    sidebar.video.pause();
    sidebar.video.removeAttribute('src');
    sidebar.video.load();
  };

  const updateFeedCopy = () => {
    if (!selectedCamera) return;
    const video = selectedFeedIsVideo();
    sidebar.live.textContent = video
      ? 'Live video'
      : selectedCamera.kind === 'red-light'
        ? 'Red-light snapshots'
        : 'Live snapshots';
    sidebar.refresh.textContent = video ? 'Reconnect stream' : 'Refresh now';
    sidebar.note.textContent = video
      ? 'Continuous stream'
      : `Refreshes every ${snapshotRefreshMs() / 1_000} seconds`;
  };

  const loadSelectedFrame = () => {
    if (!selectedCamera) return;
    clearRefreshTimer();
    sidebar.video.hidden = true;
    sidebar.video.pause();
    sidebar.frame.hidden = false;
    sidebar.frameState.hidden = false;
    sidebar.frameState.textContent = 'Refreshing live snapshot…';
    sidebar.frame.alt = `Live frame from ${selectedCamera.name || 'camera'}`;
    sidebar.frame.src = `/api/cctv/frame/${encodeURIComponent(selectedCamera.id)}?ts=${Date.now()}`;
  };

  const loadSelectedMedia = () => {
    if (!selectedCamera) return;
    stopSelectedMedia();
    updateFeedCopy();
    sidebar.frameState.hidden = false;
    if (!selectedFeedIsVideo()) {
      loadSelectedFrame();
      return;
    }
    sidebar.frame.hidden = true;
    sidebar.video.hidden = false;
    sidebar.frameState.textContent = 'Connecting live stream…';
    sidebar.video.setAttribute(
      'aria-label',
      `Live video from ${selectedCamera.name || 'camera'}`,
    );
    sidebar.video.src = `/api/cctv/media/${encodeURIComponent(selectedCamera.id)}?ts=${Date.now()}`;
    sidebar.video.play().catch(() => {
      sidebar.frameState.hidden = false;
      sidebar.frameState.textContent = 'Select play to start the live stream.';
    });
  };

  const setFeedFullscreen = (fullscreen) => {
    const active = Boolean(fullscreen && selectedCamera);
    sidebar.root.classList.toggle('is-fullscreen', active);
    sidebar.fullscreen.setAttribute(
      'aria-label',
      active ? 'Exit full-screen live feed' : 'View live feed full screen',
    );
    sidebar.fullscreen.replaceChildren(fullscreenIcon(active));
    updateFeedCopy();
    if (selectedCamera && !selectedFeedIsVideo()) loadSelectedFrame();
  };

  const closeSidebar = () => {
    stopSelectedMedia();
    selectedCamera = null;
    setFeedFullscreen(false);
    sidebar.root.classList.remove('is-open');
    sidebar.root.setAttribute('aria-hidden', 'true');
    if (map.getLayer(SELECTED_LAYER_ID)) {
      map.setFilter(SELECTED_LAYER_ID, ['==', ['get', 'id'], '']);
    }
    map.getSource(VIEW_SOURCE_ID)?.setData(EMPTY_COLLECTION);
  };

  const showCamera = (camera) => {
    stopSelectedMedia();
    selectedCamera = camera;
    sidebar.title.textContent = camera.name || 'Traffic camera';
    sidebar.fields.get('provider').textContent = camera.provider || 'Unknown';
    sidebar.fields.get('area').textContent = camera.city || 'Unknown';
    sidebar.fields.get('feed').textContent = camera.feedType || 'Snapshot';
    sidebar.fields.get('heading').textContent =
      `${Math.round(camera.headingDeg)}°`;
    sidebar.aimInput.value = String(
      (Math.round(camera.headingDeg / 5) * 5) % 360,
    );
    sidebar.aimValue.textContent = `${Math.round(camera.headingDeg)}°`;
    sidebar.root.classList.add('is-open');
    sidebar.root.setAttribute('aria-hidden', 'false');
    if (map.getLayer(SELECTED_LAYER_ID)) {
      map.setFilter(SELECTED_LAYER_ID, ['==', ['get', 'id'], camera.id]);
    }
    map.getSource(VIEW_SOURCE_ID)?.setData(viewFeature(camera));
    loadSelectedMedia();
    status.dataset.state = 'ready';
    status.textContent = camera.name || 'Camera selected';
  };

  sidebar.close.addEventListener('click', closeSidebar);
  sidebar.fullscreen.addEventListener('click', () => {
    setFeedFullscreen(!sidebar.root.classList.contains('is-fullscreen'));
  });
  sidebar.refresh.addEventListener('click', loadSelectedMedia);
  const setSelectedHeading = (heading) => {
    if (!selectedCamera) return;
    const normalized = (Number(heading) + 360) % 360;
    headingOverrides.set(selectedCamera.id, normalized);
    selectedCamera = { ...selectedCamera, headingDeg: normalized };
    visibleCameras = visibleCameras.map((camera) =>
      camera.id === selectedCamera.id ? selectedCamera : camera,
    );
    map.getSource(SOURCE_ID)?.setData(cameraFeatures(visibleCameras));
    map.getSource(VIEW_SOURCE_ID)?.setData(viewFeature(selectedCamera));
    sidebar.aimInput.value = String(normalized);
    sidebar.aimValue.textContent = `${Math.round(normalized)}°`;
    sidebar.fields.get('heading').textContent = `${Math.round(normalized)}°`;
  };
  sidebar.aimInput.addEventListener('input', (event) => {
    setSelectedHeading(event.currentTarget.value);
  });
  sidebar.aimLeft.addEventListener('click', () => {
    setSelectedHeading((selectedCamera?.headingDeg || 0) - 45);
  });
  sidebar.aimRight.addEventListener('click', () => {
    setSelectedHeading((selectedCamera?.headingDeg || 0) + 45);
  });
  sidebar.frame.addEventListener('load', () => {
    sidebar.frameState.hidden = true;
    scheduleSnapshotRefresh();
  });
  sidebar.frame.addEventListener('error', () => {
    sidebar.frame.hidden = true;
    sidebar.frameState.hidden = false;
    sidebar.frameState.textContent = 'Snapshot unavailable. Retrying…';
    scheduleSnapshotRefresh();
  });
  sidebar.video.addEventListener('playing', () => {
    sidebar.frameState.hidden = true;
  });
  sidebar.video.addEventListener('error', () => {
    if (!selectedCamera || videoFallbacks.has(selectedCamera.id)) return;
    videoFallbacks.add(selectedCamera.id);
    sidebar.frameState.hidden = false;
    sidebar.frameState.textContent =
      'Video stream unavailable. Switching to live snapshots…';
    updateFeedCopy();
    loadSelectedFrame();
  });

  const loadCatalog = async () => {
    if (catalog) return catalog;
    catalogPromise ||= fetch('/api/cctv/sources', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Camera catalog failed (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        catalog = (payload.sources || [])
          .map((camera) => ({
            ...camera,
            id: String(camera.id || ''),
            lat: Number(camera.lat),
            lon: Number(camera.lon),
            headingDeg: Number(camera.headingDeg) || 0,
            fovDeg: Number(camera.fovDeg) || 58,
            rangeM: Number(camera.rangeM) || 110,
            kind: cameraKind(camera),
          }))
          .filter(
            (camera) =>
              camera.id &&
              Number.isFinite(camera.lat) &&
              Number.isFinite(camera.lon),
          );
        return catalog;
      });
    return catalogPromise;
  };

  const updateViewport = () => {
    const source = map.getSource(SOURCE_ID);
    if (!enabled || !source || !catalog) return 0;
    const zoom = map.getZoom();
    if (zoom < 7) {
      visibleCameras = [];
      source.setData(EMPTY_COLLECTION);
      onCount(0, catalog.length);
      return 0;
    }
    const bounds = map.getBounds();
    const center = map.getCenter();
    const cap = zoom >= 15.5 ? 220 : 160;
    visibleCameras = catalog
      .filter((camera) => bounds.contains([camera.lon, camera.lat]))
      .sort((a, b) => {
        const aDistance = (a.lon - center.lng) ** 2 + (a.lat - center.lat) ** 2;
        const bDistance = (b.lon - center.lng) ** 2 + (b.lat - center.lat) ** 2;
        return aDistance - bDistance;
      })
      .slice(0, cap)
      .map((camera) =>
        headingOverrides.has(camera.id)
          ? { ...camera, headingDeg: headingOverrides.get(camera.id) }
          : camera,
      )
      .map(attachToNearestBuilding);
    source.setData(cameraFeatures(visibleCameras));
    if (selectedCamera) {
      const current = visibleCameras.find(
        (camera) => camera.id === selectedCamera.id,
      );
      if (current) {
        selectedCamera = current;
        map.getSource(VIEW_SOURCE_ID)?.setData(viewFeature(current));
      }
    }
    onCount(visibleCameras.length, catalog.length);
    return visibleCameras.length;
  };

  const install = (styleReady = false) => {
    if (!enabled || (!styleReady && !map.isStyleLoaded())) return;
    if (!modelRegistered) {
      map.addModel(MODEL_ID, MODEL_URI);
      map.addModel(RED_LIGHT_MODEL_ID, RED_LIGHT_MODEL_URI);
      map.addModel(POLE_MODEL_ID, POLE_MODEL_URI);
      modelRegistered = true;
    }
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_COLLECTION,
      });
    }
    ensureGlowImages(map);
    if (!map.getSource(VIEW_SOURCE_ID)) {
      map.addSource(VIEW_SOURCE_ID, {
        type: 'geojson',
        data: selectedCamera ? viewFeature(selectedCamera) : EMPTY_COLLECTION,
      });
    }
    if (!map.getLayer(VIEW_LAYER_ID)) {
      map.addLayer({
        id: VIEW_LAYER_ID,
        type: 'fill-extrusion',
        source: VIEW_SOURCE_ID,
        slot: 'top',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': [
            'match',
            ['get', 'kind'],
            'red-light',
            '#ff665f',
            '#70e6ec',
          ],
          'fill-extrusion-base': 0.15,
          'fill-extrusion-height': 2.4,
          'fill-extrusion-opacity': 0.12,
          'fill-extrusion-emissive-strength': 0.8,
          'fill-extrusion-vertical-gradient': true,
        },
      });
    }
    if (!map.getLayer(VIEW_EDGE_LAYER_ID)) {
      map.addLayer({
        id: VIEW_EDGE_LAYER_ID,
        type: 'line',
        source: VIEW_SOURCE_ID,
        slot: 'top',
        minzoom: 13,
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'red-light',
            '#ff8b84',
            '#9af9fb',
          ],
          'line-width': 1.4,
          'line-opacity': 0.78,
          'line-emissive-strength': 1,
          'line-occlusion-opacity': 0.72,
        },
      });
    }
    if (!map.getLayer(GLOW_LAYER_ID)) {
      map.addLayer({
        id: GLOW_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 7,
        layout: {
          'icon-image': [
            'match',
            ['get', 'kind'],
            'red-light',
            RED_GLOW_IMAGE_ID,
            GLOW_IMAGE_ID,
          ],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.42, 18, 0.95],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-pitch-alignment': 'viewport',
        },
        paint: {
          'icon-opacity': 0.86,
          'icon-emissive-strength': 1,
          'icon-occlusion-opacity': 0.94,
        },
      });
    }
    if (!map.getLayer(HALO_LAYER_ID)) {
      map.addLayer({
        id: HALO_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 7,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 18, 8],
          'circle-color': 'rgba(4, 16, 20, 0.72)',
          'circle-opacity': 0.92,
          'circle-blur': 0.04,
          'circle-stroke-color': [
            'match',
            ['get', 'kind'],
            'red-light',
            '#ff8b84',
            '#8df7f8',
          ],
          'circle-stroke-width': 1.7,
          'circle-emissive-strength': 1,
        },
      });
    }
    if (!map.getLayer(POLE_LAYER_ID)) {
      map.addLayer({
        id: POLE_LAYER_ID,
        type: 'model',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 15.5,
        layout: {
          'model-id': POLE_MODEL_ID,
          'model-allow-density-reduction': true,
        },
        filter: [
          'all',
          ['==', ['get', 'kind'], 'camera'],
          ['==', ['get', 'mountType'], 'pole'],
        ],
        paint: {
          'model-scale': [1, 1, 1],
          'model-translation': [0, 0, 0],
          'model-color': '#74969a',
          'model-color-mix-intensity': 0.18,
          'model-opacity': 1,
          'model-emissive-strength': 0.24,
          'model-roughness': 0.58,
          'model-cast-shadows': true,
          'model-receive-shadows': true,
        },
      });
    }
    if (!map.getLayer(MODEL_LAYER_ID)) {
      map.addLayer({
        id: MODEL_LAYER_ID,
        type: 'model',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 15.5,
        layout: {
          'model-id': ['get', 'model'],
          'model-allow-density-reduction': true,
        },
        filter: ['==', ['get', 'kind'], 'camera'],
        paint: {
          'model-scale': [0.62, 0.62, 0.62],
          'model-rotation': ROTATION_BY_HEADING,
          'model-translation': TRANSLATION_BY_MOUNT,
          'model-color': '#8aeaf0',
          'model-color-mix-intensity': 0.08,
          'model-opacity': 0.96,
          'model-emissive-strength': 0.42,
          'model-roughness': 0.48,
          'model-cast-shadows': true,
          'model-receive-shadows': true,
        },
      });
    }
    if (!map.getLayer(RED_LIGHT_LAYER_ID)) {
      map.addLayer({
        id: RED_LIGHT_LAYER_ID,
        type: 'model',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 15.5,
        layout: {
          'model-id': ['get', 'model'],
          'model-allow-density-reduction': true,
        },
        filter: ['==', ['get', 'kind'], 'red-light'],
        paint: {
          'model-scale': [3.2, 3.2, 3.2],
          'model-rotation': ROTATION_BY_HEADING,
          'model-translation': [0, 0, 0],
          'model-opacity': 0.98,
          'model-emissive-strength': 0.38,
          'model-roughness': 0.52,
          'model-cast-shadows': true,
          'model-receive-shadows': true,
        },
      });
    }
    if (!map.getLayer(SELECTED_LAYER_ID)) {
      map.addLayer({
        id: SELECTED_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        slot: 'top',
        minzoom: 7,
        filter: ['==', ['get', 'id'], selectedCamera?.id || ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 11, 18, 20],
          'circle-color': 'rgba(0, 0, 0, 0)',
          'circle-stroke-color': '#d9ffff',
          'circle-stroke-width': 2.4,
          'circle-stroke-opacity': 0.96,
          'circle-emissive-strength': 1,
        },
      });
    }
    updateViewport();
  };

  const setEnabled = async (nextEnabled) => {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      for (const layerId of [
        VIEW_LAYER_ID,
        VIEW_EDGE_LAYER_ID,
        GLOW_LAYER_ID,
        HALO_LAYER_ID,
        POLE_LAYER_ID,
        MODEL_LAYER_ID,
        RED_LIGHT_LAYER_ID,
        SELECTED_LAYER_ID,
      ]) {
        if (map.getLayer(layerId))
          map.setLayoutProperty(layerId, 'visibility', 'none');
      }
      map.getSource(SOURCE_ID)?.setData(EMPTY_COLLECTION);
      closeSidebar();
      onCount(0, catalog?.length || 0);
      return { enabled, visible: 0, total: catalog?.length || 0 };
    }
    status.dataset.state = 'working';
    status.textContent = 'Loading camera catalog…';
    await loadCatalog();
    install();
    for (const layerId of [
      VIEW_LAYER_ID,
      VIEW_EDGE_LAYER_ID,
      GLOW_LAYER_ID,
      HALO_LAYER_ID,
      POLE_LAYER_ID,
      MODEL_LAYER_ID,
      RED_LIGHT_LAYER_ID,
      SELECTED_LAYER_ID,
    ]) {
      if (map.getLayer(layerId))
        map.setLayoutProperty(layerId, 'visibility', 'visible');
    }
    const visible = updateViewport();
    return { enabled, visible, total: catalog.length };
  };

  map.on('moveend', updateViewport);
  map.on('style.load', () => {
    modelRegistered = false;
    install(true);
  });
  map.on('click', (event) => {
    if (!enabled || !map.getLayer(HALO_LAYER_ID)) return;
    const layers = [
      SELECTED_LAYER_ID,
      HALO_LAYER_ID,
      MODEL_LAYER_ID,
      RED_LIGHT_LAYER_ID,
    ].filter((layerId) => map.getLayer(layerId));
    const features = map.queryRenderedFeatures(event.point, {
      layers,
    });
    const feature = features[0];
    if (!feature) return;
    const camera = visibleCameras.find(
      (item) => item.id === String(feature.properties?.id || feature.id || ''),
    );
    if (!camera) return;
    showCamera(camera);
  });
  map.on('mousemove', (event) => {
    if (!enabled || !map.getLayer(HALO_LAYER_ID)) return;
    const layers = [
      SELECTED_LAYER_ID,
      HALO_LAYER_ID,
      MODEL_LAYER_ID,
      RED_LIGHT_LAYER_ID,
    ].filter((layerId) => map.getLayer(layerId));
    const overCamera = map.queryRenderedFeatures(event.point, {
      layers,
    }).length;
    map.getCanvas().style.cursor = overCamera ? 'pointer' : '';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selectedCamera) return;
    if (sidebar.root.classList.contains('is-fullscreen')) {
      setFeedFullscreen(false);
      return;
    }
    closeSidebar();
  });

  return {
    install,
    isEnabled: () => enabled,
    setEnabled,
    updateViewport,
  };
}
