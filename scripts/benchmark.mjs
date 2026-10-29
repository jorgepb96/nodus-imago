import { build } from "esbuild";
import { spawn } from "node:child_process";
import electron from "electron";
await build({
  entryPoints: ["scripts/benchmark.ts"],
  outfile: "test-results/benchmark.cjs",
  platform: "node",
  format: "cjs",
  bundle: true,
  packages: "external",
});
const child = spawn(electron, ["test-results/benchmark.cjs"], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
