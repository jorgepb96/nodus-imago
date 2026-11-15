// Generate the release description from the same English notes and order as
// the What's New window, as in Nodus Research.
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadReleaseNotes() {
  const result = await build({
    stdin: {
      contents: "export { RELEASE_NOTES } from './shared/releaseNotes'; export * from './shared/releaseNotesPresentation';",
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

export async function generateReleaseNotes(version) {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const requested = (version ?? pkg.version).replace(/^v/, "");
  if (requested !== pkg.version) throw new Error(`Release ${requested} does not match package version ${pkg.version}`);
  const { RELEASE_NOTES, releaseNoteMarkdown } = await loadReleaseNotes();
  const note = RELEASE_NOTES.find((n) => n.version === requested.split("-")[0]);
  if (!note) throw new Error(`Release ${requested} has no notes in shared/releaseNotes.ts`);
  // Every note is written in both interface languages.
  for (const highlight of note.highlights)
    for (const language of ["es", "en"])
      if (!highlight[language]?.trim()) throw new Error(`Release ${requested} has no ${language} text`);
  return releaseNoteMarkdown({ ...note, version: requested });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [version, output] = process.argv.slice(2);
  const body = await generateReleaseNotes(version);
  if (!output) process.stdout.write(body);
  else {
    await writeFile(output, body);
    console.log(`Release description written to ${output}`);
  }
}
