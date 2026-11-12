import { spawn } from "node:child_process";
import path from "node:path";
// Recent SQLite prebuilds require glibc 2.38. Compile on the native Linux
// baseline instead, including for packaged binaries. This is a developer/CI
// installation step; distributed Imago never requires Python or a compiler.
const args =
  process.platform === "linux"
    ? [
        "node_modules/@electron/rebuild/lib/cli.js",
        "--force",
        "--only",
        "better-sqlite3",
        "--build-from-source",
      ]
    : ["node_modules/electron-builder/cli.js", "install-app-deps"];
const child = spawn(
  process.execPath,
  args.map((a, i) => (i === 0 ? path.resolve(a) : a)),
  { stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
