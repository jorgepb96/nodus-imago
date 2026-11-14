// A real denying proxy isolates only this Electron child's outbound network.
// No mocked inference, network adapter changes or modifications to user settings.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { launchNative, pollNative } from "./native-test-support.mjs";
const profile = path.resolve("test-results/network-preflight-" + Date.now());
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "isolation.json"),
  JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
);
let denied = 0;
const proxy = http.createServer((_req, res) => {
  denied++;
  res.writeHead(502).end();
});
proxy.on("connect", (_req, socket) => {
  denied++;
  socket.end("HTTP/1.1 502 Network unavailable\r\nContent-Length: 0\r\n\r\n");
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const endpoint = "http://127.0.0.1:" + proxy.address().port;
process.env.NODE_USE_ENV_PROXY = "1";
process.env.HTTPS_PROXY = endpoint;
process.env.HTTP_PROXY = endpoint;
process.env.NO_PROXY = "127.0.0.1,localhost";
let app;
try {
  const native = await launchNative(profile);
  app = native.app;
  const { page, call } = native;
  await page
    .locator(".onboarding-intro")
    .getByRole("button", { name: "Preparar búsqueda local", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "Preparar búsqueda local",
    exact: true,
  });
  await region
    .getByRole("checkbox", { name: /He revisado las licencias/ })
    .check();
  await region
    .getByRole("button", { name: "Preparar búsqueda semántica", exact: true })
    .click();
  let job;
  await pollNative(async () => {
    job = (await call("jobs")).find((j) => j.kind === "prepare");
    return !!job;
  });
  const deadline = Date.now() + 10000;
  while (denied === 0 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (!denied) {
    await call("controlJob", { id: job.id, action: "cancel" });
    throw Error(
      "The integrated Node did not honor the isolated proxy; no offline claim is made.",
    );
  }
  await pollNative(async () => {
    job = (await call("jobs")).find((j) => j.id === job.id);
    return job.state === "failed";
  });
  assert.ok(job.message);
  assert.equal((await call("modelPreparation")).ready, false);
  await page.screenshot({ path: "test-results/network-preflight-e2e.png" });
  await fs.writeFile(
    "test-results/network-preflight-e2e.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        deniedProxyConnections: denied,
        jobState: job.state,
        message: job.message,
        checks: [
          "Native onboarding reports a failed real network request",
          "No ready-to-index state or inference claim while offline",
        ],
        mockedInference: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (app) await app.close();
  await new Promise((resolve) => proxy.close(resolve));
}
