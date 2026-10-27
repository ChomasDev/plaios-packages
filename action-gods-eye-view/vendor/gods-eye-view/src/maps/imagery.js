import * as Cesium from 'cesium';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export const MAPBOX_ATTRIBUTION_HTML =
  '<a href="https://www.mapbox.com/about/maps" target="_blank" rel="noopener">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createMapboxImagery(accessToken, style = 'mapbox/satellite-streets-v12') {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('Mapbox imagery requires MAPBOX_ACCESS_TOKEN');
  const normalizedStyle = String(style || '').trim();
  const match = /^([a-z0-9_-]+)\/([a-z0-9_-]+)$/i.exec(normalizedStyle);
  if (!match) throw new Error('Mapbox style must use username/style-id format');
  const [, username, styleId] = match;
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://api.mapbox.com/styles/v1/${username}/${styleId}/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`,
    tileWidth: 512,
    tileHeight: 512,
    maximumLevel: 22,
    credit: MAPBOX_ATTRIBUTION_HTML,
  });
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}
