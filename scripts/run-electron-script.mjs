// Run a repository TypeScript audit with Electron's matching native ABI, without copying the repository.
import { build } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import electron from "electron";
const entry = process.argv[2];
if (!entry || !/^scripts\/[\w-]+\.ts$/.test(entry))
  throw Error("Choose a repository scripts/*.ts entry point.");
await fs.mkdir("test-results/tools", { recursive: true });
const file = path.resolve(
  "test-results/tools",
  path.basename(entry, ".ts") + ".cjs",
);
await build({
  entryPoints: [entry],
  outfile: file,
  platform: "node",
  format: "cjs",
  bundle: true,
  packages: "external",
});
const child = spawn(electron, [file], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
child.on("exit", (code) => process.exit(code ?? 1));
