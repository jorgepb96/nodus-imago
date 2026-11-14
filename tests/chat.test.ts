// The database chat: the isolated calculation process, the streaming
// parsers, how answers are split into text, charts and calculations, the
// conversation store with folders, and the context built from a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { Repository } from "../electron/db/repository";
import { ChatStore } from "../electron/chat/store";
import { ChatData } from "../electron/chat/data";
import { runCalc, sandboxArgs } from "../electron/chat/sandbox";
import { fork } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  buildChatContext,
  buildChatUser,
  calcResultBlock,
  chatTitle,
  extractCalc,
  parseChatSegments,
  readableAnswer,
  splitSse,
  sseData,
  streamDelta,
} from "../shared/chat";

let script: Promise<string> | null = null;
/** The child script, built as the app builds it. */
function sandbox() {
  script ??= (async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "imago-sandbox-"));
    const file = path.join(dir, "sandboxChild.cjs");
    await build({
      entryPoints: ["electron/chat/sandboxChild.ts"],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
    return file;
  })();
  return script;
}
const data = JSON.stringify([
  {
    name: "Fotos",
    columns: [{ name: "Lugar", type: "text" }],
    rows: [
      { _id: "a", _images: 1, Lugar: "Sevilla", Fecha: "1925-04-01", Temas: ["Fiestas", "Calles"] },
      { _id: "b", _images: 0, Lugar: "Granada", Fecha: "c. 1930", Temas: ["Calles"] },
      { _id: "c", _images: 2, Lugar: "Sevilla", Fecha: "s. XIX", Temas: [] },
    ],
  },
]);
const calc = async (code: string, timeoutMs = 3000) =>
  runCalc(await sandbox(), code, data, new AbortController().signal, { timeoutMs, memoryMb: 128 });

test("a calculation runs over the records and returns JSON", async () => {
  const result = await calc(`
    const rows = databases[0].rows;
    console.log("filas", rows.length);
    return {
      total: rows.length,
      places: top(countBy(rows, r => r.Lugar), 5),
      subjects: countBy(rows, r => r.Temas),
      years: rows.map(r => yearOf(r.Fecha)),
    };`);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(JSON.parse(result.result), {
    total: 3,
    places: [["Sevilla", 2], ["Granada", 1]],
    subjects: { Fiestas: 1, Calles: 2 },
    years: [1925, 1930, 1850],
  });
  assert.deepEqual(result.logs, ["filas 3"]);
});

test("the calculation cannot reach the process, files, network or code generation", async () => {
  const probes = await calc(`
    return {
      process: typeof process, require: typeof require, fetch: typeof fetch,
      module: typeof module, importScripts: typeof importScripts,
      globalProcess: typeof globalThis.process,
    };`);
  assert.equal(probes.ok, true);
  if (probes.ok)
    assert.deepEqual(JSON.parse(probes.result), {
      process: "undefined", require: "undefined", fetch: "undefined",
      module: "undefined", importScripts: "undefined", globalProcess: "undefined",
    });
  // The classic escape through the constructor of a host function.
  for (const code of [
    `return (function(){}).constructor("return process")();`,
    `return this.constructor.constructor("return process")();`,
    `return eval("1+1");`,
    `return new Function("return 1")();`,
  ]) {
    const result = await calc(code);
    assert.equal(result.ok, false, code);
    if (!result.ok) assert.match(result.error, /Code generation from strings disallowed|not defined|undefined/i, code);
  }
  const dynamicImport = await calc(`return import("node:fs").then(() => "loaded", e => "blocked: " + e.message);`);
  // A promise is not JSON: whatever happens, nothing is loaded and no file is read.
  assert.ok(!dynamicImport.ok || !/loaded/.test(dynamicImport.result));
});

test("even outside the V8 context, the process cannot read files or start others", async () => {
  const dir = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), "imago-permission-")));
  const secret = path.join(dir, "secret.txt"),
    probe = path.join(dir, "probe.cjs");
  await fs.writeFile(secret, "private");
  await fs.writeFile(
    probe,
    `const attempt = (f) => { try { f(); return "allowed"; } catch (e) { return e.code || e.message; } };
     process.send({
       read: attempt(() => require("node:fs").readFileSync(${JSON.stringify(secret)}, "utf8")),
       write: attempt(() => require("node:fs").writeFileSync(${JSON.stringify(secret)}, "x")),
       spawn: attempt(() => require("node:child_process").execFileSync("ls")),
       worker: attempt(() => new (require("node:worker_threads").Worker)("1", { eval: true })),
     });`,
  );
  const result = await new Promise<Record<string, string>>((resolve, reject) => {
    const child = fork(probe, [], {
      execPath: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
      execArgv: sandboxArgs(probe, 128),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    child.on("message", (m) => {
      resolve(m as Record<string, string>);
      child.kill();
    });
    child.on("error", reject);
  });
  assert.deepEqual(result, { read: "ERR_ACCESS_DENIED", write: "ERR_ACCESS_DENIED", spawn: "ERR_ACCESS_DENIED", worker: "ERR_ACCESS_DENIED" });
  assert.equal(await fs.readFile(secret, "utf8"), "private");
  await fs.rm(dir, { recursive: true, force: true });
});

test("a calculation that never ends is stopped", async () => {
  const started = Date.now();
  const result = await calc("for (;;) {}", 500);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /timed out|tiempo/i);
  assert.ok(Date.now() - started < 10_000);
});

test("a cancelled calculation stops at once", async () => {
  const abort = new AbortController();
  const pending = runCalc(await sandbox(), "for (;;) {}", data, abort.signal, { timeoutMs: 60_000 });
  setTimeout(() => abort.abort(), 200);
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /cancelado/);
});

test("results that are too large are refused", async () => {
  const result = await calc(`return "x".repeat(300000);`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /demasiado grande/);
});

test("server-sent events are split and read for both provider formats", () => {
  const { events, rest } = splitSse('data: {"a":1}\n\ndata: {"b":\r\n\r\ndata: [DO');
  assert.deepEqual(events, ['data: {"a":1}', 'data: {"b":']);
  assert.equal(rest, "data: [DO");
  assert.equal(sseData("event: x\ndata: one\ndata: two"), "one\ntwo");
  assert.equal(sseData(": comment"), null);
  assert.deepEqual(streamDelta("openai", '{"choices":[{"delta":{"content":"Hola"}}]}'), { text: "Hola", done: false });
  assert.deepEqual(streamDelta("openai", "[DONE]"), { text: "", done: true });
  assert.deepEqual(streamDelta("anthropic", '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'), {
    text: "Hi",
    done: false,
  });
  assert.equal(streamDelta("anthropic", '{"type":"message_stop"}').done, true);
  assert.equal(streamDelta("openai", '{"error":{"message":"quota"}}').error, "quota");
});

test("an answer is split into text, charts and calculations with their results", () => {
  const text =
    "Calculo primero.\n```calc\nreturn 1;\n```" +
    calcResultBlock({ ok: true, result: "1", logs: [], ms: 4 }) +
    'Hay **1**.\n```chart\n{"type":"column","title":"Por década","items":[{"label":"1920","value":3}]}\n```\nFin.';
  const segments = parseChatSegments(text);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["md", "calc", "md", "chart", "md"],
  );
  assert.deepEqual(segments[1], { kind: "calc", code: "return 1;", result: { ok: true, result: "1", ms: 4 } });
  assert.equal(readableAnswer(text), 'Calculo primero.\n\nHay **1**.\n```chart\n{"type":"column","title":"Por década","items":[{"label":"1920","value":3}]}\n```\nFin.');
  // A calculation still being written is hidden; an invalid chart stays as text.
  assert.deepEqual(parseChatSegments("Un momento.\n```calc\nreturn da"), [{ kind: "md", text: "Un momento.\n" }]);
  assert.equal(parseChatSegments('```chart\n{"type":"bar"}\n```')[0].kind, "md");
  const asked = "a\n```calc\nreturn 2;\n```";
  assert.deepEqual(extractCalc(asked + "\nignored"), { code: "return 2;", end: asked.length });
  assert.equal(chatTitle("  ¿Cuántas   fotos hay?  "), "¿Cuántas fotos hay?");
});

test("the prompt keeps the profile, the sample and earlier turns apart", () => {
  const context = buildChatContext(
    [{ name: "Fotos", rowCount: 3, profile: "Registros: 3", sample: "1. Lugar: Sevilla", sampleSize: 1 }],
    "es",
  );
  const user = buildChatUser(
    context,
    "¿Y en Granada?",
    [
      { role: "user", content: "¿Cuántas hay en Sevilla?" },
      { role: "assistant", content: "Son 2.\n```calc\nreturn 2\n```\n```calc-result\n{}\n```" },
      { role: "assistant", content: "fallo", error: true },
    ],
    "es",
  );
  assert.match(user, /PERFIL \(calculado sobre los 3 registros\)/);
  assert.match(user, /MUESTRA: 1 registros de ejemplo de 3/);
  assert.match(user, /Asistente: Son 2\.\n/);
  assert.doesNotMatch(user, /```calc|fallo/);
  assert.match(user, /=== PREGUNTA ===\n¿Y en Granada\?$/);
});

test("conversations live in folders, and deleting a folder keeps its chats", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-chat-")),
    repo = new Repository(root);
  try {
    const store = new ChatStore(repo.db);
    const parent = store.saveFolder({ name: "Viajes" });
    const child = store.saveFolder({ name: "Andalucía", parentId: parent.id });
    assert.throws(() => store.saveFolder({ id: parent.id, parentId: child.id }), /dentro de sí misma/);
    const a = store.create({ databaseIds: ["db1"], folderId: child.id });
    const b = store.create({ databaseIds: ["db1", "db2"] });
    store.saveMessages(a.id, [{ id: "m1", role: "user", content: "Hola", createdAt: "x" }], "Hola");
    assert.equal(store.get(a.id).title, "Hola");
    assert.equal(store.get(a.id).messageCount, 1);
    store.update({ ids: [b.id], pinned: true });
    assert.ok(store.get(b.id).pinnedAt);
    store.update({ ids: [b.id], archived: true });
    assert.equal(store.get(b.id).pinnedAt, null, "archiving drops the highlight");
    assert.deepEqual(store.list(false).map((c) => c.id), [a.id]);
    assert.equal(store.archivedCount(), 1);
    store.deleteFolder(parent.id);
    assert.deepEqual(store.folders(), []);
    assert.equal(store.get(a.id).folderId, null, "the chat returns to the general history");
    store.pruneDatabase("db2");
    assert.deepEqual(store.get(b.id).databaseIds, ["db1"]);
    store.delete([a.id, b.id]);
    assert.deepEqual(store.list(true), []);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the context profiles every record and the dataset keeps plain values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-chatdata-")),
    repo = new Repository(root);
  try {
    const databaseId = repo.importCsv(
      "Fotos",
      ["ID", "Año", "Lugar", "Temas", "Revisada", "Copias"],
      ["title", "text", "select", "multi_select", "checkbox", "number"],
      [
        ["R1", "1925", "Sevilla", "Fiestas, Calles", "sí", "2"],
        ["R2", "c. 1930", "Granada", "Calles", "no", "4"],
        ["R3", "1931", "Sevilla", "", "sí", ""],
      ],
    ).database.id;
    const chat = new ChatData(repo);
    const [part] = chat.context([databaseId], "fast", "es");
    assert.equal(part.rowCount, 3);
    assert.match(part.profile, /Registros: 3/);
    assert.match(part.profile, /- Lugar \[select\]: con valor 3\/3 \(100 %\); 2 valores distintos; más frecuentes: Sevilla \(2\), Granada \(1\)/);
    assert.match(part.profile, /- Temas \[multi_select\].*Calles \(2\), Fiestas \(1\)/);
    assert.match(part.profile, /- Revisada \[checkbox\]: sí 2, no 1/);
    assert.match(part.profile, /- Copias \[number\]: con valor 2\/3; mín\. 2, máx\. 4, media 3/);
    assert.match(part.profile, /- Año \[text\].*años 1925–1931; registros por década: 1920s \(1\), 1930s \(2\)/);
    assert.equal(part.sampleSize, 3);
    const [dataset] = chat.dataset([databaseId]);
    const r1 = dataset.rows.find((r) => r.ID === "R1")!;
    assert.deepEqual(
      { Temas: r1.Temas, Revisada: r1.Revisada, Copias: r1.Copias, Lugar: r1.Lugar },
      { Temas: ["Fiestas", "Calles"], Revisada: true, Copias: 2, Lugar: "Sevilla" },
    );
    assert.equal(dataset.rows.find((r) => r.ID === "R3")!.Copias, null);
  } finally {
    repo.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
