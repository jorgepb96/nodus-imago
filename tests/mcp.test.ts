// The local MCP server: value conversions, HTTP security, the read-only
// default, the write grant, and every tool driven by a real MCP client over
// HTTP against a real service on a temporary collection.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Service } from "../electron/service";
import { McpHost } from "../electron/mcp/server";
import { registerImagoTools } from "../electron/mcp/tools";
import { runCalc } from "../electron/chat/sandbox";
import { mcpCellValue, mcpEncodeValue, mcpFilterValue, mcpMissingOptions } from "../shared/mcp";
import type { DatabaseColumn, DatabaseRow } from "../shared/databases";
import { validateCommand } from "../shared/validation";

// ── Pure conversions ─────────────────────────────────────────────────────────
const column = (type: string, extra: Partial<DatabaseColumn> = {}): DatabaseColumn => ({
  id: "c",
  databaseId: "d",
  name: "P",
  type: type as DatabaseColumn["type"],
  position: 0,
  config: {},
  options: [],
  ...extra,
});
const row = (raw: string | null): DatabaseRow => ({ id: "r", databaseId: "d", position: 0, cells: { c: raw }, createdAt: "", updatedAt: "" });
const options = [
  { id: "o1", label: "Retrato", color: null, position: 0 },
  { id: "o2", label: "Paisaje", color: null, position: 1 },
];

test("values: every writable type round-trips between plain JSON and Imago's cells", () => {
  const roundTrip = (c: DatabaseColumn, value: unknown) => mcpCellValue(c, row(mcpEncodeValue(c, value)));
  assert.equal(roundTrip(column("text"), "Hola"), "Hola");
  assert.equal(roundTrip(column("title"), "Plaza"), "Plaza");
  assert.equal(roundTrip(column("number"), 12.5), 12.5);
  assert.equal(roundTrip(column("number"), "3,5"), 3.5);
  assert.throws(() => mcpEncodeValue(column("number"), "doce"), /número no válido/);
  assert.equal(roundTrip(column("checkbox"), true), true);
  assert.equal(roundTrip(column("checkbox"), "sí"), true);
  assert.equal(roundTrip(column("checkbox"), "no"), false);
  const select = column("select", { options });
  assert.equal(roundTrip(select, "retrato"), "Retrato");
  assert.equal(roundTrip(select, "o2"), "Paisaje");
  assert.throws(() => mcpEncodeValue(select, ["Retrato", "Paisaje"]), /una sola opción/);
  assert.throws(() => mcpEncodeValue(select, "Marina"), /no existe/);
  const multi = column("multi_select", { options });
  assert.deepEqual(roundTrip(multi, ["Paisaje", "retrato", "Paisaje"]), ["Paisaje", "Retrato"]);
  assert.deepEqual(roundTrip(multi, "Retrato, Paisaje"), ["Retrato", "Paisaje"]);
  assert.deepEqual(mcpMissingOptions(multi, ["Retrato", "Marina", "marina "]), ["Marina"]);
  assert.deepEqual(mcpMissingOptions(column("text"), "x"), []);
  assert.equal(roundTrip(column("date"), "1931-04-14"), "1931-04-14");
  assert.deepEqual(roundTrip(column("date"), { start: "1931-04-14", end: "1931-04-20" }), {
    start: "1931-04-14",
    end: "1931-04-20",
    includeTime: false,
  });
  assert.throws(() => mcpEncodeValue(column("date"), "c. 1930"), /AAAA-MM-DD/);
  const historical = roundTrip(column("historical_date"), "c. 1930") as { text: string; start: number; end: number };
  assert.equal(historical.text, "c. 1930");
  assert.ok(historical.start <= 1930 && historical.end >= 1930);
  assert.deepEqual(roundTrip(column("historical_date"), { text: "Años veinte", start: 1920, end: 1929 }), {
    text: "Años veinte",
    start: 1920,
    end: 1929,
    certainty: "exact",
  });
  assert.throws(() => mcpEncodeValue(column("historical_date"), { text: "x", start: 1930, end: 1920 }), /anterior/);
  assert.deepEqual(roundTrip(column("person"), ["Ana", "Luis"]), ["Ana", "Luis"]);
  assert.deepEqual(roundTrip(column("location"), { name: "Sevilla", latitude: 37.39, longitude: -5.99 }), {
    name: "Sevilla",
    address: null,
    latitude: 37.39,
    longitude: -5.99,
  });
  assert.deepEqual(roundTrip(column("relation"), ["a", "b", "a"]), ["a", "b"]);
  assert.equal(mcpEncodeValue(column("text"), null), null);
  assert.equal(mcpEncodeValue(column("select", { options }), ""), null);
  for (const type of ["formula", "rollup", "unique_id", "created_time", "attachment", "button"])
    assert.throws(() => mcpEncodeValue(column(type), "x"), /no se puede escribir/);
});

test("values: filters name options by label and people by name", () => {
  assert.deepEqual(mcpFilterValue(column("multi_select", { options }), ["paisaje", "o1"]), ["o2", "o1"]);
  assert.equal(mcpFilterValue(column("person"), "Ana"), "person:ana");
  assert.equal(mcpFilterValue(column("text"), "Ana"), "Ana");
  assert.throws(() => mcpFilterValue(column("select", { options }), "Marina"), /no existe/);
});

test("validation: the settings commands accept only their own fields", () => {
  assert.deepEqual(validateCommand("mcpConfigure", { access: "write" }), { access: "write" });
  assert.throws(() => validateCommand("mcpConfigure", { access: "admin" }));
  assert.throws(() => validateCommand("mcpConfigure", { port: 80 }));
  assert.throws(() => validateCommand("mcpConfigure", { token: "x" }));
  assert.equal(validateCommand("mcpStatus", undefined), undefined);
});

// ── The server and the tools, end to end ─────────────────────────────────────
let root = "";
let service: Service;
let host: McpHost;
let changes = 0;
let sandboxFile = "";

async function sandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "imago-mcp-sandbox-"));
  const file = path.join(dir, "sandboxChild.cjs");
  await build({ entryPoints: ["electron/chat/sandboxChild.ts"], outfile: file, bundle: true, platform: "node", format: "cjs", logLevel: "silent" });
  return file;
}

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-mcp-"));
  service = new Service(path.join(root, "collection"), "not-used", () => {});
  sandboxFile = await sandbox();
  // Turned on as the settings would, before the host reads its file.
  await fs.writeFile(path.join(root, "mcp.json"), JSON.stringify({ enabled: true, port: 4329 }));
  host = new McpHost({
    file: path.join(root, "mcp.json"),
    version: "0.0.0-test",
    listenPort: 0,
    context: {
      call: (command, input) => service.run(command, input),
      changed: () => {
        changes++;
      },
      calc: (code, json, timeoutMs) => runCalc(sandboxFile, code, json, new AbortController().signal, { timeoutMs, memoryMb: 256 }),
    },
  });
  await host.start();
});

after(async () => {
  await host?.stop();
  await service?.run("_close");
  await fs.rm(root, { recursive: true, force: true });
  if (sandboxFile) await fs.rm(path.dirname(sandboxFile), { recursive: true, force: true });
});

const url = () => host.status().url!;
async function connect(token = host.status().token) {
  const client = new Client({ name: "imago-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url()), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}
type ToolResult = { content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content.find((c) => c.type === "text")?.text ?? "null";
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { result, data, isError: !!result.isError };
}
async function ok(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await callTool(client, name, args);
  assert.equal(r.isError, false, `${name} failed: ${JSON.stringify(r.data)}`);
  return r.data;
}
function raw(options: { method?: string; headers?: Record<string, string>; path?: string; body?: string }) {
  const target = new URL(url());
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: target.port, path: options.path ?? target.pathname, method: options.method ?? "POST", headers: options.headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode!, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
const initialize = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
});
const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

const READ_TOOLS = [
  "imago_get_overview", "imago_list_databases", "imago_get_database", "imago_query_records", "imago_get_record",
  "imago_search", "imago_find_similar_images", "imago_get_image", "imago_summarize_property", "imago_compute_statistic",
  "imago_count_values", "imago_timeline", "imago_run_calculation", "imago_list_saved", "imago_list_jobs",
];
const WRITE_TOOLS = [
  "imago_create_database", "imago_update_database", "imago_delete_database", "imago_add_property", "imago_update_property",
  "imago_convert_property", "imago_delete_property", "imago_reorder_properties", "imago_create_records", "imago_update_records",
  "imago_delete_records", "imago_import_images", "imago_annotate_image", "imago_delete_annotation", "imago_run_ai_properties",
  "imago_undo", "imago_redo",
];

test("server: loopback only, a token, the settings file outside the collection", async () => {
  const status = host.status();
  assert.equal(status.running, true);
  assert.match(status.url!, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.equal(status.config.access, "read", "read only unless granted");
  assert.ok(status.token.length >= 40);
  const stat = await fs.stat(path.join(root, "mcp.json"));
  // POSIX permissions; Windows protects the profile folder with its own ACLs.
  if (process.platform !== "win32") assert.equal(stat.mode & 0o777, 0o600);
  const stored = JSON.parse(await fs.readFile(path.join(root, "mcp.json"), "utf8"));
  assert.equal(stored.token, status.token);
  // Nothing about MCP inside the collection (what backups copy).
  const files = await fs.readdir(path.join(root, "collection"), { recursive: true });
  assert.ok(!files.some((f) => String(f).includes("mcp")));
  const db = service.repo.db.prepare("SELECT count(*) n FROM settings WHERE value LIKE ?").get(`%${status.token}%`) as { n: number } | undefined;
  assert.ok(!db?.n);
});

test("server: refuses no token, a wrong token, foreign hosts and origins, unknown paths and sessions", async () => {
  const token = host.status().token;
  assert.equal((await raw({ headers: jsonHeaders, body: initialize })).status, 401);
  assert.equal((await raw({ headers: { ...jsonHeaders, Authorization: "Bearer nope" }, body: initialize })).status, 401);
  assert.equal((await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}x` }, body: initialize })).status, 401);
  assert.equal((await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, Host: "evil.example" }, body: initialize })).status, 403);
  assert.equal(
    (await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, Origin: "https://evil.example" }, body: initialize })).status,
    403,
  );
  assert.equal((await raw({ path: "/other", headers: { ...jsonHeaders, Authorization: `Bearer ${token}` }, body: initialize })).status, 404);
  assert.equal(
    (await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}`, "mcp-session-id": "gone" }, body: initialize })).status,
    404,
  );
  assert.equal((await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}` }, body: "{not json" })).status, 400);
  assert.equal(
    (await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status,
    400,
  );
  const accepted = await raw({ headers: { ...jsonHeaders, Authorization: `Bearer ${token}` }, body: initialize });
  assert.equal(accepted.status, 200);
});

let photos = "";
let people = "";
let image = "";

test("read only: the client sees only read tools and cannot write", async () => {
  // Some data, written through the service as the window would.
  const created = await service.run("createDatabase", { name: "Fotografías", kind: "images" });
  photos = created.database.id;
  const client = await connect();
  try {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...READ_TOOLS].sort());
    for (const tool of (await client.listTools()).tools) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    const refused = await callTool(client, "imago_create_database", { name: "No" });
    assert.equal(refused.isError, true);
    assert.equal((await service.run("listDatabases")).length, 1);
    const overview = await ok(client, "imago_get_overview");
    assert.equal(overview.access, "read");
    assert.equal(overview.collection.databases, 1);
    assert.match(overview.write, /Read only/);
  } finally {
    await client.close();
  }
});

test("tools: a write tool checks the access again when it runs", async () => {
  const tools = new Map<string, (args: unknown) => Promise<ToolResult>>();
  const fake = { registerTool: (name: string, _meta: unknown, fn: (args: unknown) => Promise<ToolResult>) => tools.set(name, fn) };
  let access: "read" | "write" = "write";
  registerImagoTools(fake as never, { call: (c, i) => service.run(c, i), access: () => access, changed: () => {}, version: "t" }, { write: true });
  assert.ok(WRITE_TOOLS.every((name) => tools.has(name)));
  assert.ok(!tools.has("imago_run_calculation"), "no calculation without the isolated process");
  access = "read";
  const result = await tools.get("imago_create_database")!({ name: "Coladas" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text!, /solo ha concedido lectura/);
  assert.equal((await service.run("listDatabases")).length, 1);
});

test("write: granting access closes old sessions; the new one creates databases, properties and records", async () => {
  const old = await connect();
  await host.configure({ access: "write" });
  assert.equal(host.status().config.access, "write");
  await assert.rejects(old.listTools(), "the old read-only session is closed");
  await old.close().catch(() => {});
  const client = await connect();
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) assert.ok(names.includes(name), name);
    const destructive = (await client.listTools()).tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    assert.ok(destructive.includes("imago_delete_database") && destructive.includes("imago_delete_records"));

    const before = changes;
    const peopleDb = await ok(client, "imago_create_database", { name: "Personas", kind: "custom" });
    people = peopleDb.id;
    assert.ok(changes > before, "the window is told to refresh");
    await ok(client, "imago_create_records", {
      database: "Personas",
      records: [{ values: { Título: "Ana Pérez" } }, { values: { Título: "Luis Gómez" } }],
    });

    // Properties of many types on the photographs database.
    const added = [];
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Tipo", type: "select", options: ["Retrato", "Paisaje"] }));
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Copias", type: "number" }));
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Revisada", type: "checkbox" }));
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Captura", type: "date" }));
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Web", type: "url" }));
    added.push(await ok(client, "imago_add_property", { database: photos, name: "Fotógrafo", type: "person" }));
    added.push(
      await ok(client, "imago_add_property", {
        database: photos,
        name: "Retratados",
        type: "relation",
        relation: { targetDatabase: "Personas", twoWayName: "Aparece en" },
      }),
    );
    added.push(
      await ok(client, "imago_add_property", {
        database: photos,
        name: "Nº retratados",
        type: "rollup",
        rollup: { relationProperty: "Retratados", targetProperty: "__title__", function: "count" },
      }),
    );
    assert.deepEqual(added[0].options.map((o: { label: string }) => o.label), ["Retrato", "Paisaje"]);
    assert.equal(added[6].relationTarget.name, "Personas");
    assert.equal(added[7].writable, false);
    const peopleSchema = await ok(client, "imago_get_database", { database: "Personas" });
    assert.ok(peopleSchema.properties.some((p: { name: string; type: string }) => p.name === "Aparece en" && p.type === "relation"), "two-way relation");
    const bad = await callTool(client, "imago_add_property", { database: photos, name: "X", type: "relation" });
    assert.equal(bad.isError, true);
    assert.match(bad.data.error, /targetDatabase/);

    const schema = await ok(client, "imago_get_database", { database: "Fotografías" });
    const byName = Object.fromEntries(schema.properties.map((p: { name: string }) => [p.name, p]));
    assert.ok(byName["Categorías"] && byName["Fecha"] && byName["Ubicación"], "the images template");
    assert.ok(byName["Tipo"].filterOperators.includes("any"));

    const records = await ok(client, "imago_create_records", {
      database: "Fotografías",
      records: [
        {
          values: {
            Título: "Plaza de España",
            Tipo: "Paisaje",
            Copias: 3,
            Revisada: true,
            Captura: "1929-05-09",
            Fecha: "c. 1929",
            Ubicación: { name: "Sevilla", latitude: 37.377, longitude: -5.987 },
            Categorías: ["Arquitectura", "Exposición"],
            Fotógrafo: ["Ana Pérez"],
            Retratados: ["Ana Pérez", "Luis Gómez"],
            Web: "https://example.org/plaza",
          },
        },
        { values: { Título: "Retrato de Ana", Tipo: "Retrato", Copias: 1, Fecha: "1935", Categorías: ["Retrato"], Retratados: ["Ana Pérez"] } },
        { values: { Título: "Muelle", Tipo: "Marina", Copias: 5, Fecha: "s. XIX", Categorías: "Puerto, Arquitectura" } },
      ],
    });
    assert.equal(records.created, 3);
    const refusedOption = await callTool(client, "imago_create_records", {
      database: "Fotografías",
      records: [{ values: { Título: "Sin opción", Tipo: "Bodegón" } }],
      createMissingOptions: false,
    });
    assert.equal(refusedOption.isError, true);
    assert.match(refusedOption.data.error, /Bodegón/);
    const unknown = await callTool(client, "imago_create_records", { database: "Fotografías", records: [{ values: { Inexistente: 1 } }] });
    assert.equal(unknown.isError, true);
    assert.match(unknown.data.error, /no tiene la propiedad/);
    const badRelation = await callTool(client, "imago_create_records", {
      database: "Fotografías",
      records: [{ values: { Título: "Bien" } }, { values: { Título: "Mal", Retratados: ["Nadie Conocido"] } }],
    });
    assert.equal(badRelation.isError, true);
    assert.match(badRelation.data.error, /ningún registro/);
    assert.equal((await service.run("listDatabases")).find((d: { id: string }) => d.id === photos).rowCount, 3, "a refused call creates nothing");

    // Read everything back as plain values.
    const all = await ok(client, "imago_query_records", { database: "Fotografías", sorts: [{ property: "Copias", direction: "asc" }] });
    assert.equal(all.total, 3);
    assert.deepEqual(all.records.map((r: { title: string }) => r.title), ["Retrato de Ana", "Plaza de España", "Muelle"]);
    const plaza = all.records[1].values;
    assert.equal(plaza.Tipo, "Paisaje");
    assert.equal(plaza.Copias, 3);
    assert.equal(plaza.Revisada, true);
    assert.equal(plaza.Captura, "1929-05-09");
    assert.equal(plaza.Fecha.text, "c. 1929");
    assert.equal(plaza.Ubicación.name, "Sevilla");
    assert.deepEqual(plaza.Categorías, ["Arquitectura", "Exposición"]);
    assert.deepEqual(plaza.Fotógrafo, ["Ana Pérez"]);
    assert.equal(plaza.Retratados.length, 2);
    assert.equal(String(plaza["Nº retratados"]), "2");
    assert.equal(all.records[2].values.Tipo, "Marina", "a missing option is created");
    const filtered = await ok(client, "imago_query_records", {
      database: photos,
      filters: [
        { property: "Categorías", op: "any", value: ["arquitectura"] },
        { property: "Copias", op: "gte", value: "3" },
      ],
      properties: ["Título", "Copias"],
      includeImages: false,
    });
    assert.equal(filtered.total, 2);
    assert.deepEqual(Object.keys(filtered.records[0].values).sort(), ["Copias", "Título"]);
    const period = await ok(client, "imago_query_records", { database: photos, filters: [{ property: "Fecha", op: "equals", value: "1850" }] });
    assert.deepEqual(period.records.map((r: { title: string }) => r.title), ["Muelle"]);
    const literal = await ok(client, "imago_query_records", { database: photos, search: { text: "plaza" } });
    assert.deepEqual(literal.records.map((r: { title: string }) => r.title), ["Plaza de España"]);
    const paged = await ok(client, "imago_query_records", { database: photos, limit: 2, offset: 2 });
    assert.equal(paged.returned, 1);
    assert.equal(paged.hasMore, false);

    const plazaId = all.records[1].id;
    const full = await ok(client, "imago_get_record", { recordId: plazaId });
    assert.ok(full.properties.find((p: { name: string; type: string }) => p.name === "Retratados").type === "relation");
    assert.ok(full.linkedRecords, "linked records are listed");
    const anaId = plaza.Retratados[0];
    const ana = await ok(client, "imago_get_record", { recordId: anaId });
    assert.ok(ana.values["Aparece en"].includes(plazaId), "the twin relation follows");

    // Updates, clearing and undo.
    await ok(client, "imago_update_records", { updates: [{ recordId: plazaId, values: { Copias: 4, Web: null, Tipo: "retrato" } }] });
    let again = await ok(client, "imago_get_record", { recordId: plazaId });
    assert.equal(again.values.Copias, 4);
    assert.equal(again.values.Web, null);
    assert.equal(again.values.Tipo, "Retrato");
    const undone = await ok(client, "imago_undo");
    assert.equal(undone.changes, 3, "one tool call is one Undo step");
    again = await ok(client, "imago_get_record", { recordId: plazaId });
    assert.equal(again.values.Tipo, "Paisaje");
    assert.equal(again.values.Copias, 3);
    assert.equal(again.values.Web, "https://example.org/plaza");
    await ok(client, "imago_redo");
    again = await ok(client, "imago_get_record", { recordId: plazaId });
    assert.equal(again.values.Tipo, "Retrato");
    assert.equal(again.values.Copias, 4);
    const computed = await callTool(client, "imago_update_records", { updates: [{ recordId: plazaId, values: { "Nº retratados": 9 } }] });
    assert.equal(computed.isError, true);
    assert.match(computed.data.error, /no se puede escribir/);
    const missingRecord = await callTool(client, "imago_update_records", { updates: [{ recordId: "nope", values: { Copias: 1 } }] });
    assert.equal(missingRecord.isError, true);
  } finally {
    await client.close();
  }
});

test("figures: summaries, statistics, counts, timeline and an isolated calculation", async () => {
  const client = await connect();
  try {
    assert.equal((await ok(client, "imago_summarize_property", { database: photos, property: "Copias", function: "sum" })).value, "10");
    assert.equal((await ok(client, "imago_summarize_property", { database: photos, property: "Copias", function: "median" })).value, "4");
    const sumFiltered = await ok(client, "imago_summarize_property", {
      database: photos,
      property: "Copias",
      function: "count",
      filters: [{ property: "Tipo", op: "any", value: ["Retrato"] }],
    });
    assert.equal(sumFiltered.records, 2);
    const frequency = await ok(client, "imago_compute_statistic", { database: photos, kind: "frequency", property: "Categorías" });
    assert.ok(JSON.stringify(frequency).includes("Arquitectura"));
    const crosstab = await ok(client, "imago_compute_statistic", { database: photos, kind: "crosstab", rowProperty: "Tipo", columnProperty: "Revisada" });
    assert.ok(crosstab);
    const numeric = await ok(client, "imago_compute_statistic", { database: photos, kind: "numeric", property: "Copias", bins: 3 });
    assert.ok(numeric);
    const trend = await ok(client, "imago_compute_statistic", { database: photos, kind: "trend", yearProperty: "Fecha", bucket: "decade" });
    assert.ok(trend);
    const missing = await callTool(client, "imago_compute_statistic", { database: photos, kind: "crosstab", rowProperty: "Tipo" });
    assert.equal(missing.isError, true);
    const counts = await ok(client, "imago_count_values", { database: photos, property: "Categorías" });
    assert.deepEqual(counts.values[0], { value: "Arquitectura", count: 2 });
    assert.equal(counts.records, 3);
    const timeline = await ok(client, "imago_timeline", { database: photos, property: "Fecha" });
    assert.ok(timeline);
    const calc = await ok(client, "imago_run_calculation", {
      databases: ["Fotografías"],
      code: "const rows = databases[0].rows; console.log('n', rows.length); return { total: rows.reduce((s, r) => s + (r.Copias ?? 0), 0), top: top(countBy(rows, r => r['Categorías']), 1) };",
    });
    assert.equal(calc.result.total, 10);
    assert.deepEqual(calc.result.top, [["Arquitectura", 2]]);
    assert.deepEqual(calc.logs, ["n 3"]);
    const escape = await callTool(client, "imago_run_calculation", { databases: [photos], code: "return require('fs').readdirSync('/')" });
    assert.equal(escape.isError, true, "the calculation has no modules");
    const saved = await ok(client, "imago_list_saved", { database: photos });
    assert.deepEqual(saved, { views: [], statistics: [] });
    const search = await ok(client, "imago_search", { query: "Muelle", mode: "literal" });
    assert.deepEqual(search.records.map((r: { title: string }) => r.title), ["Muelle"]);
    // Semantic search needs a model; without one it either answers with its coverage or says why not.
    const semantic = await callTool(client, "imago_search", { query: "un puerto con barcos", mode: "semantic" });
    if (semantic.isError) assert.ok(semantic.data.error);
    else assert.ok("indexedImages" in semantic.data);
  } finally {
    await client.close();
  }
});

test("images: import, look at a photograph, annotate it and find it by its record", async () => {
  const client = await connect();
  try {
    const folder = path.join(root, "incoming");
    await fs.mkdir(folder);
    await sharp({ create: { width: 640, height: 400, channels: 3, background: "#33668a" } })
      .composite([{ input: Buffer.from('<svg width="640" height="400"><rect x="40" y="40" width="200" height="120" fill="#ffcc00"/></svg>'), top: 0, left: 0 }])
      .jpeg()
      .toFile(path.join(folder, "Muelle.jpg"));
    await fs.writeFile(path.join(folder, "notas.txt"), "no es una imagen");
    const imported = await ok(client, "imago_import_images", { database: photos, paths: [folder] });
    assert.equal(imported.files, 1);
    let state = "";
    for (let i = 0; i < 200 && state !== "completed"; i++) {
      const jobs = (await ok(client, "imago_list_jobs")).jobs;
      state = jobs.find((j: { id: string }) => j.id === imported.jobId)?.state;
      if (state === "failed") assert.fail("import failed");
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(state, "completed");
    const withImages = await ok(client, "imago_query_records", { database: photos, filters: [{ property: "Imágenes", op: "not_empty" }] });
    assert.equal(withImages.total, 1);
    const record = withImages.records[0];
    assert.equal(record.images.length, 1);
    image = record.images[0].imageId;

    const shown = await callTool(client, "imago_get_image", { imageId: image, maxSize: 320 });
    assert.equal(shown.isError, false, JSON.stringify(shown.data));
    const picture = shown.result.content.find((c) => c.type === "image")!;
    assert.equal(picture.mimeType, "image/jpeg");
    const meta = await sharp(Buffer.from(picture.data!, "base64")).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(Math.max(meta.width!, meta.height!), 320);
    assert.equal(shown.data.images[0].originalSize.width, 640);
    assert.equal(shown.data.record.id, record.id);
    const byRecord = await callTool(client, "imago_get_image", { recordId: record.id });
    assert.equal(byRecord.result.content.filter((c) => c.type === "image").length, 1);
    assert.equal((await callTool(client, "imago_get_image", { imageId: "nope" })).isError, true);
    assert.equal((await callTool(client, "imago_get_image", {})).isError, true);

    const note = await ok(client, "imago_annotate_image", { imageId: image, region: { x: 0.06, y: 0.1, w: 0.31, h: 0.3 }, note: "Rótulo amarillo", tags: ["rótulo"] });
    const full = await ok(client, "imago_get_record", { recordId: record.id });
    assert.equal(full.annotations.length, 1);
    assert.equal(full.annotations[0].note, "Rótulo amarillo");
    assert.equal((await callTool(client, "imago_get_image", { imageId: image })).data.images[0].annotations.length, 1);
    await ok(client, "imago_delete_annotation", { annotationId: note.id });
    assert.equal((await ok(client, "imago_get_record", { recordId: record.id })).annotations.length, 0);
    const similar = await callTool(client, "imago_find_similar_images", { imageId: image });
    if (similar.isError) assert.ok(similar.data.error);
  } finally {
    await client.close();
  }
});

test("schema changes: options, conversion, order, deletion and the database guard", async () => {
  const client = await connect();
  try {
    await ok(client, "imago_update_property", {
      database: photos,
      property: "Tipo",
      name: "Género",
      addOptions: ["Bodegón"],
      renameOptions: [{ from: "Marina", to: "Vista marítima" }],
    });
    let schema = await ok(client, "imago_get_database", { database: photos });
    const genre = schema.properties.find((p: { name: string }) => p.name === "Género");
    assert.deepEqual(genre.options.map((o: { label: string }) => o.label), ["Retrato", "Paisaje", "Vista marítima", "Bodegón"]);
    const inUse = await callTool(client, "imago_update_property", { database: photos, property: "Género", removeOptions: ["Retrato"] });
    assert.equal(inUse.isError, true);
    assert.match(inUse.data.error, /en uso/);
    await ok(client, "imago_update_property", { database: photos, property: "Género", removeOptions: ["Bodegón"] });
    const muelle = (await ok(client, "imago_query_records", { database: photos, search: { text: "Muelle" } })).records.find(
      (r: { title: string }) => r.title === "Muelle",
    );
    assert.equal(muelle.values["Género"], "Vista marítima", "renaming keeps the values");

    const preview = await ok(client, "imago_convert_property", { database: photos, property: "Copias", type: "text", apply: false });
    assert.ok(preview);
    assert.equal((await ok(client, "imago_get_database", { database: photos })).properties.find((p: { name: string }) => p.name === "Copias").type, "number");
    await ok(client, "imago_convert_property", { database: photos, property: "Copias", type: "text", apply: true });
    schema = await ok(client, "imago_get_database", { database: photos });
    assert.equal(schema.properties.find((p: { name: string }) => p.name === "Copias").type, "text");

    const order = schema.properties.map((p: { id: string }) => p.id).reverse();
    const reordered = await ok(client, "imago_reorder_properties", { database: photos, properties: order });
    assert.equal(reordered.order[0], schema.properties.at(-1).name);

    await ok(client, "imago_delete_property", { database: photos, property: "Web" });
    schema = await ok(client, "imago_get_database", { database: photos });
    assert.ok(!schema.properties.some((p: { name: string }) => p.name === "Web"));

    const renamed = await ok(client, "imago_update_database", { database: "Personas", name: "Personas retratadas" });
    assert.equal(renamed.name, "Personas retratadas");
    const guard = await callTool(client, "imago_delete_database", { database: people, confirmName: "Personas" });
    assert.equal(guard.isError, true);
    assert.match(guard.data.error, /confirmName/);
    const count = (await service.run("listDatabases")).length;
    await ok(client, "imago_delete_database", { database: people, confirmName: "Personas retratadas" });
    assert.equal((await service.run("listDatabases")).length, count - 1);
    const gone = await callTool(client, "imago_get_database", { database: "Personas retratadas" });
    assert.equal(gone.isError, true);
    assert.match(gone.data.error, /No existe la base de datos/);
  } finally {
    await client.close();
  }
});

test("access back to read only: write tools disappear; a new token locks out old clients; off closes the port", async () => {
  const writer = await connect();
  await host.configure({ access: "read" });
  await assert.rejects(writer.listTools());
  await writer.close().catch(() => {});
  const reader = await connect();
  const names = (await reader.listTools()).tools.map((t) => t.name);
  assert.ok(!names.some((n) => WRITE_TOOLS.includes(n)));
  await reader.close();

  const activity = host.status().activity;
  assert.ok(activity.length > 0 && activity.length <= 50);
  assert.ok(activity.some((a) => a.write && a.ok));
  assert.ok(activity.some((a) => !a.ok && a.error));
  assert.ok(activity.every((a) => !("arguments" in a)), "no arguments in the log");

  const oldToken = host.status().token;
  await host.regenerateToken();
  assert.notEqual(host.status().token, oldToken);
  await assert.rejects(connect(oldToken));
  const fresh = await connect();
  await fresh.close();

  const port = new URL(url()).port;
  await host.configure({ enabled: false });
  assert.equal(host.status().running, false);
  await assert.rejects(
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/mcp", method: "POST" }, resolve);
      req.on("error", reject);
      req.end();
    }),
  );
  // The settings survive a restart of the host.
  const reread = new McpHost({ file: path.join(root, "mcp.json"), version: "t", context: { call: async () => null, changed: () => {} } });
  assert.deepEqual(reread.status().config, { enabled: false, port: 4329, access: "read" });
  await assert.rejects(host.configure({ port: 80 }), /1024/);
  await host.configure({ enabled: true });
  assert.equal(host.status().running, true);
});

test("settings file: an unreadable or tampered file falls back to off and read only", async () => {
  const file = path.join(root, "broken.json");
  await fs.writeFile(file, "{oops");
  const broken = new McpHost({ file, version: "t", context: { call: async () => null, changed: () => {} } });
  assert.deepEqual(broken.status().config, { enabled: false, port: 4329, access: "read" });
  await fs.writeFile(file, JSON.stringify({ enabled: "yes", access: "admin", port: 22, token: "short" }));
  const tampered = new McpHost({ file, version: "t", context: { call: async () => null, changed: () => {} } });
  assert.deepEqual(tampered.status().config, { enabled: false, port: 4329, access: "read" });
  assert.equal(tampered.status().token, "");
});
