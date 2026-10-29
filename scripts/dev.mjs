import { spawn } from "node:child_process";
import { build } from "esbuild";
import { createServer } from "vite";
import electron from "electron";
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
});
const server = await createServer();
await server.listen();
const env = { ...process.env, IMAGO_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill());
