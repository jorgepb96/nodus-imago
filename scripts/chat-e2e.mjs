// Database chat against a mock OpenAI-compatible server on 127.0.0.1: the
// answer streams, the model asks for one calculation, the isolated process
// runs it over every record (also inside the packaged app, where its script
// is unpacked from the asar) and the conversation is saved with its folder.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { launchNative } from "./native-test-support.mjs";

const CALC = `const db = databases[0];
const counts = countBy(db.rows, r => { const y = yearOf(r["Año"]); return y == null ? null : Math.floor(y / 10) * 10; });
return { total: db.rows.length, decades: Object.entries(counts).map(([d, n]) => [Number(d), n]).sort((a, b) => a[0] - b[0]) };`;
const requests = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const json = JSON.parse(body || "{}");
    requests.push(json);
    const last = json.messages?.at(-1)?.content ?? "";
    let answer;
    if (/Resultado del cálculo/.test(last)) {
      const result = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(last)[1]);
      answer =
        `Hay ${result.total} registros.\n\n| Década | Registros |\n|---|---:|\n` +
        result.decades.map(([d, n]) => `| ${d}s | ${n} |`).join("\n") +
        "\n\n```chart\n" +
        JSON.stringify({ type: "column", title: "Registros por década", items: result.decades.map(([d, n]) => ({ label: `${d}s`, value: n })) }) +
        "\n```";
    } else answer = "Lo calculo sobre todos los registros.\n```calc\n" + CALC + "\n```";
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of answer.match(/[\s\S]{1,16}/g)) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 5));
    }
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const root = path.resolve("test-results/chat-e2e-" + Date.now()),
  profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "isolation.json"),
  JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }),
);
const { app, page, call } = await launchNative(profile);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  const database = await page.evaluate(async (port) => {
    const api = window.imago;
    await api.call("updateSettings", {
      language: "es",
      apiProfiles: { lmstudio: { baseUrl: `http://127.0.0.1:${port}/v1`, models: ["analista"] } },
    });
    const d = await api.call("createDatabase", { name: "Postales" });
    const title = d.columns.find((c) => c.type === "title");
    const year = await api.call("addColumn", { databaseId: d.database.id, name: "Año", type: "text" });
    const ids = await api.call("createRows", { databaseId: d.database.id, count: 60 });
    for (let i = 0; i < ids.length; i++) {
      await api.call("setCell", { rowId: ids[i], columnId: title.id, value: "P" + String(i + 1).padStart(3, "0") });
      await api.call("setCell", { rowId: ids[i], columnId: year.id, value: i % 2 ? `c. ${1900 + i}` : String(1900 + i) });
    }
    return d.database;
  }, server.address().port);
  await page.reload();
  await page.locator('[data-tour="nav-chat"]').click();
  const view = page.locator('[data-testid="chat-view"]');
  await view.waitFor();
  await view.locator("textarea").fill("¿Cuántos registros hay por década?");
  await view.locator("textarea").press("Enter");
  await view.locator(".chat-chart").waitFor({ timeout: 60000 });
  await view.locator('[data-testid="chat-send"]').waitFor({ timeout: 30000 });
  assert.equal(requests.length, 2, "one request asks for the calculation, one receives its result");
  assert.ok(requests.every((r) => r.stream === true));
  assert.match(requests[0].messages[1].content, /PERFIL \(calculado sobre los 60 registros\)/);
  const feedback = requests[1].messages.at(-1).content;
  assert.match(feedback, /Resultado del cálculo/, feedback);
  const result = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(feedback)[1]);
  assert.deepEqual(result, {
    total: 60,
    decades: [1900, 1910, 1920, 1930, 1940, 1950].map((d) => [d, 10]),
  });
  assert.match(await view.locator('[data-testid="chat-calc"]').innerText(), /Cálculo en el entorno aislado/);

  // Saved with a title, then filed in a folder from its menu.
  const list = await call("chatList", {});
  assert.equal(list.conversations.length, 1);
  assert.equal(list.conversations[0].title, "¿Cuántos registros hay por década?");
  assert.deepEqual(list.conversations[0].databaseIds, [database.id]);
  const saved = await call("chatGet", { id: list.conversations[0].id });
  assert.equal(saved.messages.length, 2);
  assert.match(saved.messages[1].content, /```calc-result/);
  const folder = await call("chatFolderSave", { name: "Postales antiguas" });
  await page.reload();
  await page.locator('[data-tour="nav-chat"]').click();
  const row = view.locator(".research-history-chat").first();
  await row.hover();
  await row.getByRole("button", { name: "Más acciones" }).click();
  await page.getByRole("menuitem", { name: "Mover a carpeta" }).click();
  await page.getByRole("menuitemradio", { name: "Postales antiguas" }).click();
  await view.locator(".research-folder-row", { hasText: "Postales antiguas" }).waitFor();
  assert.equal((await call("chatList", {})).conversations[0].folderId, folder.id);

  // The panel beside the database reads that database.
  await page.locator(".sidebar-databases > button", { hasText: "Postales" }).click();
  await page.locator('[data-tour="db-chat"]').click();
  const panel = page.locator('[data-testid="chat-panel"]');
  await panel.waitFor();
  assert.match(await panel.locator('[data-testid="chat-context-toggle"]').innerText(), /Postales/);
  assert.deepEqual(errors, []);
  console.log("chat e2e ok");
} finally {
  await app.close().catch(() => {});
  server.close();
}
