import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  mapboxAccessToken,
  mapboxStyle,
  cesiumOptions,
  embedded = false,
  host = 'localhost',
  port = 4173,
} = {}) {
  return {
    plugins: [cesium(cesiumOptions), applicationHtmlPlugin(), ...plugins],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      allowedHosts:
        host === '0.0.0.0' || host === '::'
          ? true
          : ['localhost', '127.0.0.1', '.local'],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // The standalone app protects Provider Settings from framing. Agent OS
      // deliberately embeds its own bundled copy and supplies the containing UI.
      ...(embedded
        ? {}
        : {
            headers: {
              'X-Frame-Options': 'DENY',
              'Content-Security-Policy': "frame-ancestors 'none'",
            },
          }),
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      'import.meta.env.MAPBOX_ACCESS_TOKEN': JSON.stringify(mapboxAccessToken),
      'import.meta.env.MAPBOX_STYLE': JSON.stringify(mapboxStyle),
      'import.meta.env.AGENT_OS_EMBEDDED': JSON.stringify(embedded),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
