// First-run introduction and guided tour: every tour step points at a control
// that exists, and every text has English.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { translate } from "../src/i18n";
import { TOUR_STEPS } from "../src/components/GuidedTour";
import { SLIDES } from "../src/welcomeSlides";

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith(".tsx") ? [fs.readFileSync(path.join(dir, e.name), "utf8")] : [],
  );

test("every tour step targets a data-tour control present in the interface", () => {
  const code = sources("src").join("\n");
  const missing = TOUR_STEPS.filter((s) => s.target && !code.includes(`data-tour="${s.target}"`) && !code.includes(`"${s.target}" :`)).map((s) => s.target);
  assert.deepEqual(missing, []);
  // Starts and ends with a centred card, so the tour always has a beginning and an end.
  assert.equal(TOUR_STEPS[0].target, undefined);
  assert.equal(TOUR_STEPS.at(-1)!.target, undefined);
});

test("introduction and tour texts have English", () => {
  const texts = [
    ...SLIDES.flatMap((s) => [s.eyebrow, s.title, s.summary, s.tip ?? "", ...(s.points ?? []).flatMap((p) => [p.title, p.body])]),
    ...TOUR_STEPS.flatMap((s) => [s.title, s.body, ...(s.items ?? [])]),
  ].filter(Boolean);
  const untranslated = texts.filter((s) => translate(s, "en") === s && s !== "Literal");
  assert.deepEqual(untranslated, []);
});

test("test drivers never see the introduction unless a test asks for it", () => {
  const main = fs.readFileSync("electron/main.ts", "utf8");
  assert.match(main, /remote-debugging-port/);
  assert.match(main, /IMAGO_FORCE_WELCOME/);
});
