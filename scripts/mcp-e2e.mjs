// The local MCP server in the real app, on an isolated profile: turned on from
// Settings, read only by default, write access only through the confirmation
// window, and a real MCP client whose changes the window shows.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { launchNative, seedNativeImages, pollNative } from "./native-test-support.mjs";

const root = path.resolve("test-results/mcp-e2e-" + Date.now()),
  profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(profile, "isolation.json"), JSON.stringify({ format: "nodus.imago.native-qa/1", root: profile }));
const { app, page, call } = await launchNative(profile);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = async (name) => {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
  await fs.writeFile(path.join(root, name + ".png"), Buffer.from(png, "base64"));
};
async function connect(status) {
  const client = new Client({ name: "imago-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(status.url), { requestInit: { headers: { Authorization: `Bearer ${status.token}` } } }),
  );
  return client;
}
const json = (result) => JSON.parse(result.content.find((c) => c.type === "text").text);

try {
  const seeded = await seedNativeImages(app, call, path.join(root, "images"));
  const databaseName = "Fuentes de prueba nativa";
  assert.ok(seeded);

  // Settings → Servidor MCP: off and read only.
  await page.getByRole("button", { name: "Ajustes", exact: true }).first().click();
  await page.getByRole("button", { name: "Servidor MCP", exact: true }).click();
  const panel = page.getByTestId("mcp-settings");
  await panel.waitFor();
  assert.match(await page.getByTestId("mcp-state").innerText(), /Apagado/);
  assert.equal(await page.getByTestId("mcp-access-read").getAttribute("aria-checked"), "true");
  assert.equal((await call("mcpStatus")).running, false);
  await shot("1-off");

  // Turn it on.
  await page.getByTestId("mcp-enabled").check();
  await pollNative(async () => /Activo/.test(await page.getByTestId("mcp-state").innerText()));
  let status = await call("mcpStatus");
  assert.equal(status.running, true);
  assert.equal(status.config.access, "read");
  assert.equal(await page.getByTestId("mcp-url").innerText(), status.url);
  assert.ok(!(await page.getByTestId("mcp-token").innerText()).includes(status.token), "the token is hidden until asked");
  assert.ok((await page.getByTestId("mcp-claude-config").innerText()).includes(status.url));

  // ChatGPT: the guided tunnel set-up, without contacting OpenAI.
  await panel.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  await page.getByTestId("mcp-tunnel").waitFor();
  assert.match(await page.getByTestId("mcp-tunnel-phase").innerText(), /Sin conectar/);
  assert.equal(await page.getByTestId("mcp-tunnel-step").count(), 3);
  assert.ok((await page.getByTestId("mcp-tunnel-privacy").innerText()).includes("OpenAI"));
  const connectTunnel = page.getByTestId("mcp-tunnel-connect");
  assert.equal(await connectTunnel.isDisabled(), true);
  await page.getByTestId("mcp-tunnel-id").fill("tunnel_wrong");
  await page.getByText("El ID debe empezar por tunnel_", { exact: false }).first().waitFor();
  await page.getByTestId("mcp-tunnel-id").fill("tunnel_0123456789abcdef0123456789abcdef");
  assert.equal(await connectTunnel.isDisabled(), true, "a key is needed too");
  await page.getByTestId("mcp-tunnel-key").fill("sk-test-not-real");
  assert.equal(await connectTunnel.isDisabled(), false);
  assert.equal(await page.getByTestId("mcp-tunnel-key").getAttribute("type"), "password");
  const tunnelStatus = await call("mcpTunnelStatus");
  assert.equal(tunnelStatus.phase, "not_configured");
  assert.ok(!JSON.stringify(tunnelStatus).includes("sk-test-not-real"));
  await page.screenshot({ path: path.join(root, "1b-chatgpt.png") });
  await page.getByTestId("mcp-tunnel-key").fill("");
  await panel.getByRole("tab", { name: "Claude Desktop", exact: true }).click();

  // A read-only client.
  const reader = await connect(status);
  const readTools = (await reader.listTools()).tools.map((t) => t.name);
  assert.ok(readTools.includes("imago_query_records") && !readTools.includes("imago_create_records"));
  const databases = json(await reader.callTool({ name: "imago_list_databases", arguments: {} })).databases;
  assert.ok(databases.some((d) => d.name === databaseName));
  const records = json(await reader.callTool({ name: "imago_query_records", arguments: { database: databaseName } }));
  assert.equal(records.total, 2);
  const picture = await reader.callTool({ name: "imago_get_image", arguments: { recordId: records.records[0].id, maxSize: 256 } });
  assert.equal(picture.content[0].type, "image");
  assert.equal(picture.content[0].mimeType, "image/jpeg");
  const refused = await reader.callTool({ name: "imago_create_records", arguments: { database: databaseName, records: [{ values: { Título: "No" } }] } });
  assert.equal(refused.isError, true);
  await pollNative(async () => (await page.getByTestId("mcp-activity").locator("li").count()) >= 3);

  // Write access: the confirmation window, cancelled first.
  await page.getByTestId("mcp-access-write").click();
  const confirm = page.getByTestId("mcp-write-confirm");
  await confirm.waitFor();
  const allow = page.getByTestId("mcp-write-allow");
  assert.equal(await allow.isDisabled(), true, "allowed only after «Entiendo»");
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, "2-confirm.png") });
  await page.locator("dialog.modal[open]").getByRole("button", { name: "Cancelar", exact: true }).click();
  await confirm.waitFor({ state: "detached" });
  assert.equal((await call("mcpStatus")).config.access, "read", "cancelling keeps read only");
  // …then accepted.
  await page.getByTestId("mcp-access-write").click();
  await page.getByTestId("mcp-write-understood").check();
  await allow.click();
  await pollNative(async () => (await call("mcpStatus")).config.access === "write");
  assert.equal(await page.getByTestId("mcp-access-write").getAttribute("aria-checked"), "true");
  await assert.rejects(reader.listTools(), "granting access closes the read-only session");
  await reader.close().catch(() => {});

  status = await call("mcpStatus");
  const writer = await connect(status);
  assert.ok((await writer.listTools()).tools.some((t) => t.name === "imago_create_records"));
  const created = json(
    await writer.callTool({
      name: "imago_add_property",
      arguments: { database: databaseName, name: "Color", type: "select", options: ["Rojo", "Azul"] },
    }),
  );
  assert.equal(created.type, "select");
  const added = await writer.callTool({
    name: "imago_create_records",
    arguments: { database: databaseName, records: [{ values: { Título: "Creado desde MCP", Color: "Azul" } }] },
  });
  assert.ok(!added.isError, JSON.stringify(added.content));
  await shot("3-write");

  // The window shows what the client wrote.
  await page.getByRole("button", { name: databaseName }).first().click();
  // Titles are editable fields: look at their values as well as the text.
  await pollNative(
    () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll("input,textarea")].some((el) => el.value === "Creado desde MCP") ||
          document.body.innerText.includes("Creado desde MCP"),
      ),
    15000,
  );
  await page.getByText("Azul", { exact: true }).first().waitFor();
  await shot("4-record-in-window");
  await writer.close();

  // Back to read only, then off: the port closes.
  await page.getByRole("button", { name: "Ajustes", exact: true }).first().click();
  await page.getByRole("button", { name: "Servidor MCP", exact: true }).click();
  await page.getByTestId("mcp-access-read").click();
  await pollNative(async () => (await call("mcpStatus")).config.access === "read");
  await page.getByTestId("mcp-enabled").uncheck();
  await pollNative(async () => !(await call("mcpStatus")).running);
  await assert.rejects(connect(status));

  // The settings live in the profile, never in the collection.
  const stored = JSON.parse(await fs.readFile(path.join(profile, "mcp.json"), "utf8"));
  assert.deepEqual({ enabled: stored.enabled, access: stored.access }, { enabled: false, access: "read" });
  const inCollection = await fs.readdir(path.join(profile, "collection"), { recursive: true });
  assert.ok(!inCollection.some((f) => String(f).includes("mcp")));
  assert.deepEqual(errors, []);
  console.log(`MCP e2e passed. Screenshots in ${root}`);
} catch (error) {
  await shot("failure").catch(() => {});
  throw error;
} finally {
  await app.close();
}
