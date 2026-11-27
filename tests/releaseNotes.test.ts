// The release notes: which ones the What's New window offers, that every
// version has them, and that the GitHub description follows the window's order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, RELEASE_NOTES, releaseNotesUpTo, type ReleaseNote } from "../shared/releaseNotes";
import { groupHighlightsByScope, releaseNoteMarkdown, releaseNoteSections } from "../shared/releaseNotesPresentation";
import { version } from "../package.json";

test("the window offers every version up to the installed one, newest first", () => {
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  const notes: ReleaseNote[] = ["0.3.0", "0.2.1", "0.2.0", "0.1.0"].map((v) => ({ version: v, date: "", highlights: [] }));
  assert.deepEqual(releaseNotesUpTo("0.2.1", notes).map((n) => n.version), ["0.2.1", "0.2.0", "0.1.0"]);
  assert.deepEqual(releaseNotesUpTo("0.2.1-beta.1", notes).map((n) => n.version), ["0.2.1", "0.2.0", "0.1.0"]);
});

test("the installed version has its notes, in Spanish and English, newest first", () => {
  assert.equal(RELEASE_NOTES[0].version, version, "add the notes of the new version to shared/releaseNotes.ts");
  for (let i = 1; i < RELEASE_NOTES.length; i++) assert.equal(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version), 1);
  for (const note of RELEASE_NOTES) {
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(note.highlights.length, `${note.version} has no highlights`);
    for (const h of note.highlights) assert.ok(h.es.trim() && h.en.trim(), `${note.version}: ${h.en}`);
  }
});

test("sections keep the order new features, enhancements, fixes; the largest scope first", () => {
  const note: ReleaseNote = {
    version: "9.0.0",
    date: "2026-01-01",
    highlights: [
      { scope: "general", category: "fix", es: "a", en: "Fix A", fr: "Correction A" },
      { scope: "visual", category: "new", es: "b", en: "New B", fr: "Nouveau B" },
      { scope: "places", category: "new", es: "c", en: "New C", fr: "Nouveau C" },
      { scope: "places", category: "new", es: "d", en: "New D", fr: "Nouveau D" },
    ],
  };
  assert.deepEqual(
    releaseNoteSections(note).map((s) => [s.category, s.highlights.map((h) => h.en)]),
    [
      ["new", ["New C", "New D", "New B"]],
      ["enhancement", []],
      ["fix", ["Fix A"]],
    ],
  );
  assert.equal(
    releaseNoteMarkdown(note),
    "# Nodus Imago 9.0.0\n\n## New features\n\n- New C\n\n- New D\n\n- New B\n\n## Enhancements\n\nNo changes in this section.\n\n## Fixes\n\n- Fix A\n",
  );
  assert.deepEqual(groupHighlightsByScope([]), []);
});
