// Guided tutorials: every step points at a control that exists, every text
// has English, and the search finds tutorials the way a researcher types.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { translate } from "../src/i18n";
import { fold, nextTutorial, searchTutorials, TUTORIAL_LEVELS, TUTORIALS } from "../src/tutorials";
import { DATABASE_VIEWS } from "../src/columnPrefs";

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [fs.readFileSync(path.join(dir, e.name), "utf8")] : [],
  );
const code = sources("src").join("\n");
/** Controls named in the code, plus the families built from a value. */
const anchors = new Set([
  ...[...code.matchAll(/data-tour(?:=|": )"([^"]+)"/g)].map((m) => m[1]),
  // data-tour={condition ? "name" : undefined}
  ...[...code.matchAll(/data-tour=\{[^?}]+\? "([^"]+)" : undefined\}/g)].map((m) => m[1]),
]);
const settingsTabs = [...fs.readFileSync("src/components/Settings.tsx", "utf8").matchAll(/\{\s*id:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]);
const families: [string, string[], RegExp][] = [
  ["view-", [...DATABASE_VIEWS], /"data-tour": `view-\$\{id\}`/],
  ["settings-tab-", settingsTabs, /data-tour=\{`settings-tab-\$\{id\}`\}/],
  ["record-prop-", ["location", "rich_text", "text", "multi_select", "select", "date"], /data-tour=\{`record-prop-\$\{c\.type\}`\}/],
];
const exists = (target: string) =>
  anchors.has(target) ||
  families.some(([prefix, values, pattern]) => target.startsWith(prefix) && values.includes(target.slice(prefix.length)) && pattern.test(code));

test("every tutorial step points at a control that exists", () => {
  const missing = TUTORIALS.flatMap((tutorial) =>
    tutorial.steps.flatMap((step) =>
      [step.target, step.until].filter((t): t is string => !!t && !exists(t)).map((t) => `${tutorial.id}: ${t}`),
    ),
  );
  assert.deepEqual(missing, []);
});

test("tutorials are short, unique and on a known level", () => {
  const ids = TUTORIALS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(TUTORIALS.length >= 15);
  for (const tutorial of TUTORIALS) {
    assert.ok(tutorial.steps.length >= 1 && tutorial.steps.length <= 8, tutorial.id);
    assert.ok(TUTORIAL_LEVELS.some((l) => l.id === tutorial.level), tutorial.id);
    assert.ok(tutorial.minutes >= 1 && tutorial.minutes <= 5, tutorial.id);
    // The last step has nothing to wait for: «Terminar» ends it.
    assert.equal(tutorial.steps.at(-1)!.until, undefined, tutorial.id);
  }
});

test("the list is a learning path: levels in order, each one together", () => {
  const levels = TUTORIALS.map((t) => TUTORIAL_LEVELS.findIndex((l) => l.id === t.level));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  for (const level of TUTORIAL_LEVELS) assert.ok(TUTORIALS.some((t) => t.level === level.id), level.id);
  // A tutorial that names another one as a prerequisite comes after it.
  for (const tutorial of TUTORIALS)
    for (const other of TUTORIALS)
      if (tutorial.needs?.includes(`«${other.title}»`))
        assert.ok(TUTORIALS.indexOf(other) < TUTORIALS.indexOf(tutorial), `${other.id} before ${tutorial.id}`);
  // It starts with the database itself, and the next one is the first not done.
  assert.equal(TUTORIALS[0].id, "first-database");
  assert.equal(nextTutorial([])!.id, "first-database");
  assert.equal(nextTutorial(["first-database"])!.id, TUTORIALS[1].id);
  assert.equal(nextTutorial(TUTORIALS.map((t) => t.id)), null);
});

test("every tutorial text has English", () => {
  const texts = [
    ...TUTORIAL_LEVELS.flatMap((l) => [l.label, l.summary]),
    ...TUTORIALS.flatMap((t) => [
      t.title,
      t.summary,
      t.needs ?? "",
      ...t.steps.flatMap((s) => [s.title, s.body, s.missing ?? "", ...(s.items ?? [])]),
    ]),
  ].filter(Boolean);
  const untranslated = [...new Set(texts)].filter((s) => translate(s, "en") === s && !["Chat", "Red"].includes(s));
  assert.deepEqual(untranslated, []);
});

test("the asked-for tutorials are there", () => {
  const ids = TUTORIALS.map((t) => t.id);
  for (const id of ["attach-image", "ai-describe", "ai-tags", "add-place", "annotate", "edit-properties", "import-catalog", "then-now", "authorities", "plates"])
    assert.ok(ids.includes(id), id);
});

test("search ignores accents and case, needs every word and puts title matches first", () => {
  assert.equal(fold("Búsqueda SEMÁNTICA"), "busqueda semantica");
  const ids = (q: string, tr?: (s: string) => string) => searchTutorials(q, tr).map((t) => t.id);
  assert.equal(ids("").length, TUTORIALS.length);
  assert.equal(ids("etiquetas")[0], "ai-tags");
  assert.ok(ids("ubicacion").includes("add-place"));
  assert.ok(ids("comentario").includes("annotate"));
  assert.ok(ids("adjuntar imagen").includes("attach-image"));
  assert.ok(ids("descripcion IA").includes("ai-describe"));
  // Every word must match somewhere.
  assert.deepEqual(ids("etiquetas zzzz"), []);
  // English, through the interface translation and the keywords.
  const en = (s: string) => translate(s, "en");
  assert.equal(ids("tags", en)[0], "ai-tags");
  assert.ok(ids("place on the map", en).includes("add-place"));
  assert.ok(ids("backup", en).includes("backups"));
});
