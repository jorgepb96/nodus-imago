import { build } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import electron from "electron";
await fs.mkdir("test-results/tools", { recursive: true });
const file = path.resolve("test-results/tools/update-protocol.cjs");
await build({
  entryPoints: ["scripts/update-protocol.ts"],
  outfile: file,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electron,
  [...(env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : []), file],
  { stdio: "inherit", env },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
