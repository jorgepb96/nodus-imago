import { build } from "esbuild";
import { readdir, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import electron from "electron";
await mkdir("test-results/unit", { recursive: true });
const tests = (await readdir("tests"))
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => "tests/" + f);
await build({
  entryPoints: tests,
  outdir: "test-results/unit",
  platform: "node",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  packages: "external",
});
const child = spawn(
  electron,
  [
    "--test",
    "--test-concurrency=1",
    ...tests.map(
      (f) => "test-results/unit/" + f.split("/").pop().replace(".ts", ".cjs"),
    ),
  ],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
);
child.on("exit", (code) => process.exit(code ?? 1));
