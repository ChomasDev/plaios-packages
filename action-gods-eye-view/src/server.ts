import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { createServer, type InlineConfig, type ViteDevServer } from "vite";

export interface BundledServerOptions {
  baseUrl: string;
  googleMapsApiKey?: string;
  cesiumIonToken?: string;
  mapboxAccessToken?: string;
  mapboxStyle?: string;
  openAiApiKey?: string;
}

type BrowserConfigFactory = (options: Record<string, unknown>) => InlineConfig;
type PluginFactoryModule = { localProviderPlugins(): NonNullable<InlineConfig["plugins"]> };
type NotFoundModule = { apiNotFoundPlugin(): NonNullable<InlineConfig["plugins"]>[number] };

export class BundledGodsEyeViewServer {
  private server: ViteDevServer | null = null;
  private startPromise: Promise<void> | null = null;
  private readonly restoredEnvironment = new Map<string, string | undefined>();

  constructor(private readonly options: BundledServerOptions) {}

  async ensureStarted(): Promise<void> {
    this.startPromise ??= this.start();
    return this.startPromise;
  }

  async close(): Promise<void> {
    await this.startPromise?.catch(() => undefined);
    await this.server?.close();
    this.server = null;
    this.startPromise = null;
    for (const [key, value] of this.restoredEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    this.restoredEnvironment.clear();
  }

  private async start(): Promise<void> {
    const url = new URL(this.options.baseUrl);
    const root = resolveVendorRoot();
    this.applyEnvironment("OPENAI_API_KEY", this.options.openAiApiKey);
    this.applyEnvironment("GOOGLE_MAPS_API_KEY", this.options.googleMapsApiKey);
    this.applyEnvironment("CESIUM_ION_TOKEN", this.options.cesiumIonToken);

    const [{ createBrowserViteConfig }, providers, notFound] = await Promise.all([
      import(pathToFileURL(resolve(root, "build/vite.js")).href) as Promise<{
        createBrowserViteConfig: BrowserConfigFactory;
      }>,
      import(pathToFileURL(resolve(root, "server/providers/local.js")).href) as Promise<PluginFactoryModule>,
      import(pathToFileURL(resolve(root, "server/standalone/api-not-found.js")).href) as Promise<NotFoundModule>,
    ]);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    const require = createRequire(import.meta.url);
    const cesiumRoot = resolve(require.resolve("cesium/package.json"), "..");
    const appConfig = createBrowserViteConfig({
      plugins: [...providers.localProviderPlugins(), notFound.apiNotFoundPlugin()],
      googleApiKey: this.options.googleMapsApiKey,
      cesiumToken: this.options.cesiumIonToken,
      mapboxAccessToken: this.options.mapboxAccessToken,
      mapboxStyle: this.options.mapboxStyle,
      cesiumOptions: {
        cesiumBuildRootPath: resolve(cesiumRoot, "Build"),
        cesiumBuildPath: resolve(cesiumRoot, "Build/Cesium"),
      },
      embedded: true,
      host: url.hostname,
      port,
    });
    this.server = await createServer({
      ...appConfig,
      root,
      configFile: false,
      server: {
        ...appConfig.server,
        host: url.hostname,
        port,
        strictPort: true,
      },
    });
    await this.server.listen();
  }

  private applyEnvironment(key: string, value: string | undefined): void {
    if (!value || process.env[key] === value) return;
    if (!this.restoredEnvironment.has(key)) {
      this.restoredEnvironment.set(key, process.env[key]);
    }
    process.env[key] = value;
  }
}

function resolveVendorRoot(): string {
  const candidates = [
    fileURLToPath(new URL("../vendor/gods-eye-view/", import.meta.url)),
    fileURLToPath(new URL("../../vendor/gods-eye-view/", import.meta.url)),
  ];
  const root = candidates.find((candidate) => existsSync(resolve(candidate, "package.json")));
  if (!root) throw new Error("Bundled God's Eye View source is missing from the action package");
  return root;
}
