import { build } from "esbuild";
await build({
  entryPoints: [
    "electron/main.ts",
    "electron/preload.ts",
    "electron/worker.ts",
  ],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  packages: "external",
  sourcemap: true,
});
