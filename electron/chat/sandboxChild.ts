// Runs one chat calculation. This process is started with Node's permission
// model (no file system beyond this script, no child processes, no workers,
// no addons) and the code runs in a fresh V8 context without `require`,
// `process`, network APIs or code generation from strings. Only strings
// cross the boundary: the data goes in as JSON text and the result comes out
// as JSON text, so no object of this process is reachable from the code.
import vm from "node:vm";

const PRELUDE = `
"use strict";
const __logs = [];
globalThis.console = {
  log: (...args) => {
    if (__logs.length < 50)
      __logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ").slice(0, 500));
  },
};
const __roman = { I: 1, V: 5, X: 10, L: 50, C: 100 };
globalThis.yearOf = (value) => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isInteger(value) && value >= 1000 && value <= 2200 ? value : null;
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  let m = /^(-?\\d{4})-\\d{2}/.exec(text);
  if (m) return Number(m[1]);
  m = /(?:^|[^\\d])(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})(?!\\d)/.exec(text);
  if (m) return Number(m[1]);
  m = /\\b(?:s\\.|siglo|sec\\.|century)\\s*([IVXLC]{1,6})\\b/i.exec(text);
  if (m) {
    const r = m[1].toUpperCase();
    let total = 0;
    for (let i = 0; i < r.length; i++) {
      const v = __roman[r[i]], next = __roman[r[i + 1]] || 0;
      total += v < next ? -v : v;
    }
    if (total >= 1 && total <= 22) return (total - 1) * 100 + 50;
  }
  return null;
};
globalThis.countBy = (rows, f) => {
  const out = {};
  for (const row of rows) {
    const value = f(row);
    for (const v of new Set(Array.isArray(value) ? value : [value])) {
      if (v == null || v === "") continue;
      const key = String(v);
      out[key] = (out[key] || 0) + 1;
    }
  }
  return out;
};
globalThis.top = (object, n = 10) =>
  Object.entries(object).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
`;

const MAX_RESULT = 200_000;

process.on("message", (message: { code: string; json: string; timeoutMs: number }) => {
  const started = Date.now();
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  const logs = () => {
    try {
      return JSON.parse(vm.runInContext("JSON.stringify(__logs)", context, { timeout: 500 })) as string[];
    } catch {
      return [];
    }
  };
  try {
    vm.runInContext(PRELUDE, context, { timeout: 1000 });
    // A primitive string is copied into the context; it carries no prototype
    // of this process.
    context.__json = message.json;
    vm.runInContext("globalThis.databases = JSON.parse(__json); delete globalThis.__json;", context, {
      timeout: 20_000,
    });
    const text = vm.runInContext(
      `JSON.stringify((function () { "use strict";\n${message.code}\n})() ?? null)`,
      context,
      { timeout: message.timeoutMs, filename: "calc.js" },
    );
    if (typeof text !== "string") throw new Error("El cálculo no devolvió un valor JSON.");
    if (text.length > MAX_RESULT)
      throw new Error("El resultado es demasiado grande; devuelve un resumen o los primeros elementos.");
    process.send!({ ok: true, result: text, logs: logs(), ms: Date.now() - started });
  } catch (error) {
    let text = String((error as Error)?.message ?? error).slice(0, 1000);
    if (/Script execution timed out/.test(text)) text = "El cálculo ha superado el tiempo máximo.";
    process.send!({ ok: false, error: text, logs: logs(), ms: Date.now() - started });
  }
});
