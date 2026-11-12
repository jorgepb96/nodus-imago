import { _electron as electron } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
export async function launchNative(profile) {
  const isolation = JSON.parse(
    await fs.readFile(path.join(profile, "isolation.json"), "utf8"),
  );
  if (
    isolation.format !== "nodus.imago.native-qa/1" ||
    isolation.root !== path.resolve(profile) ||
    !path.resolve(profile).startsWith(path.resolve("test-results") + path.sep)
  )
    throw Error("Refusing a non-isolated native test profile.");
  const env = { ...process.env, IMAGO_USER_DATA: path.resolve(profile) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.IMAGO_DEV_URL;
  const app = await electron.launch(
    process.env.IMAGO_E2E_EXECUTABLE
      ? {
          executablePath: process.env.IMAGO_E2E_EXECUTABLE,
          args: process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : [],
          env,
        }
      : {
          args: [
            ".",
            ...(process.env.IMAGO_E2E_NO_SANDBOX ? ["--no-sandbox"] : []),
          ],
          env,
        },
  );
  const page = await app
    .firstWindow({ timeout: 60000 })
    .catch(async (error) => {
      await app.close().catch(() => {});
      throw error;
    });
  page.setDefaultTimeout(30000);
  await page
    .getByRole("heading", {
      name: "Tu espacio de investigación visual",
      exact: true,
    })
    .waitFor();
  return {
    app,
    page,
    call: (command, input) =>
      page.evaluate(({ command, input }) => window.imago.call(command, input), {
        command,
        input,
      }),
  };
}
export async function pollNative(work, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!(await work())) {
    if (Date.now() > deadline) throw Error("Native condition timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}
export async function waitNativeJob(call, id, timeout = 30 * 60_000) {
  if (!id) return;
  await pollNative(async () => {
    const job = (await call("jobs")).find((j) => j.id === id);
    if (!job) throw Error("Job absent: " + id);
    if (job.state === "failed") throw Error(job.message || "Native job failed");
    if (job.state === "cancelled") throw Error("Native job cancelled");
    return job.state === "completed";
  }, timeout);
}
export async function seedNativeImages(app, call, folder) {
  await fs.mkdir(folder, { recursive: true });
  const files = [];
  for (const [name, color, shape] of [
    ["Red square", "#c42121", '<rect x="70" y="60" width="200" height="200"/>'],
    ["Blue circle", "#235bba", '<circle cx="170" cy="160" r="100"/>'],
  ]) {
    const file = path.join(folder, name + ".png");
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="320"><rect width="340" height="320" fill="white"/><g fill="${color}">${shape}</g></svg>`,
      ),
    )
      .png()
      .toFile(file);
    files.push(file);
  }
  const database = await call("createDatabase", {
      name: "Fuentes de prueba nativa",
    }),
    rows = [];
  for (let i = 0; i < files.length; i++) {
    const row = await call("createRow", { databaseId: database.database.id });
    rows.push(row.id);
    await call("setCell", {
      rowId: row.id,
      columnId: database.columns.find((c) => c.type === "title").id,
      value: i ? "Blue circle" : "Red square",
    });
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, files[i]);
    const plan = await call("imagePreview", {
      databaseId: database.database.id,
      source: "files",
    });
    await waitNativeJob(
      call,
      await call("importImages", {
        token: plan.token,
        storage: "copy",
        createUnmatched: false,
        assignments: plan.matches.map((m) => ({
          pathToken: m.pathToken,
          rowId: row.id,
        })),
      }),
    );
  }
  return { database: database.database, rows, files };
}
