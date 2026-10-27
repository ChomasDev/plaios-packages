import { build } from "esbuild";

await build({
  entryPoints: ["src/web.tsx"],
  outfile: "dist/web/memory.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: [
    "react",
    "react/jsx-runtime",
    "@plaios/microfrontend",
  ],
});
