// One cross-platform driver for source and installed executables. Never copies the repository.
import { spawn } from "node:child_process";
const entries = [
  "scripts/e2e.mjs",
  "scripts/audit-e2e.mjs",
  "scripts/places-e2e.mjs",
  "scripts/map-e2e.mjs",
  "scripts/criteria-e2e.mjs",
  "scripts/agreement-e2e.mjs",
  "scripts/phase2-e2e.mjs",
  "scripts/backups-e2e.mjs",
  "scripts/update-protocol-e2e.mjs",
];
for (const entry of entries) {
  const args =
    process.platform === "linux"
      ? ["-a", "env", "IMAGO_E2E_NO_SANDBOX=1", process.execPath, entry]
      : [entry];
  const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
  console.log("Running", entry, process.env.IMAGO_E2E_EXECUTABLE || "source");
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (code !== 0) process.exit(Number(code));
}
