// Architecture-safe macOS merge follows Nodus Research's merge-mac-update-manifest.
// Every listed artifact is rehashed; Linux keeps its upstream per-architecture feeds.
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { updateArtifactArchitecture } from "../shared/updateArtifacts.mjs";
import { load, dump } from "js-yaml";
/**
 * `macIntel: false` prepares a release without the Intel build, which
 * release-macos-intel.yml appends after publication (as in Nodus Research).
 */
export async function mergeUpdateFeeds(root, output, expectedVersion, { macIntel = true } = {}) {
  const groups = new Map(),
    artifacts = new Map();
  async function walk(folder) {
    for (const e of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.isFile()) {
        if (/^(latest|beta)(-mac|-linux(-arm64)?)?\.yml$/.test(e.name)) {
          const manifest = load(await fs.readFile(file, "utf8"));
          if (manifest.version !== expectedVersion)
            throw Error("Mismatched feed version: " + file);
          const list = groups.get(e.name) || [];
          list.push(manifest);
          groups.set(e.name, list);
        } else if (/\.(zip|dmg|exe|AppImage|deb|rpm|blockmap)$/.test(e.name)) {
          if (artifacts.has(e.name))
            throw Error("Duplicate artifact " + e.name);
          artifacts.set(e.name, file);
        }
      }
    }
  }
  await walk(root);
  const channel = expectedVersion.includes("-") ? "beta" : "latest";
  const required = [
    `${channel}-mac.yml`,
    `${channel}.yml`,
    `${channel}-linux.yml`,
    `${channel}-linux-arm64.yml`,
  ];
  for (const name of required)
    if (!groups.has(name)) throw Error("Missing platform feed " + name);
  const written = [];
  await fs.mkdir(output, { recursive: true });
  for (const name of required) {
    const manifests = groups.get(name),
      files = new Map();
    for (const m of manifests)
      for (const f of m.files || []) {
        if (!f.url || path.basename(f.url) !== f.url || !artifacts.has(f.url))
          throw Error("Missing or unsafe artifact " + f.url);
        if (
          files.has(f.url) &&
          JSON.stringify(files.get(f.url)) !== JSON.stringify(f)
        )
          throw Error("Conflicting feed entry " + f.url);
        files.set(f.url, f);
      }
    const ordered = [...files.values()].sort(
      (a, b) =>
        Number(b.url.includes("-arm64.")) - Number(a.url.includes("-arm64.")),
    );
    const packages = name.includes("-mac")
      ? [
          ["darwin", "arm64", "zip"],
          ...(macIntel ? [["darwin", "x64", "zip"]] : []),
          ["darwin", "arm64", "dmg"],
          ...(macIntel ? [["darwin", "x64", "dmg"]] : []),
        ]
      : name.includes("linux")
        ? ["AppImage", "deb", "rpm"].map((extension) => [
            "linux",
            name.includes("linux-arm64") ? "arm64" : "x64",
            extension,
          ])
        : [["win32", "x64", "exe"]];
    const expected = packages.map(
      ([platform, arch, extension]) =>
        `${updateArtifactArchitecture(platform, arch, extension)}.${extension}`,
    );
    for (const suffix of expected)
      if (
        !ordered.some(
          (f) => f.url === `Nodus-Imago-${name.includes("-mac") ? "mac" : name.includes("linux") ? "linux" : "win"}-${suffix}`,
        )
      )
        throw Error("Missing architecture/package " + suffix);
    for (const f of ordered) {
      const file = artifacts.get(f.url),
        hash = createHash("sha512");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (
        f.sha512 !== hash.digest("base64") ||
        (f.size !== undefined && f.size !== (await fs.stat(file)).size)
      )
        throw Error("Artifact checksum/size mismatch " + f.url);
    }
    const extension = name.includes("-mac")
        ? ".zip"
        : name.includes("linux")
          ? ".AppImage"
          : ".exe",
      primary = ordered.find((f) => f.url.endsWith(extension));
    const merged = {
      version: expectedVersion,
      files: ordered,
      path: primary.url,
      sha512: primary.sha512,
      releaseDate: manifests[0].releaseDate,
    };
    const target = path.join(output, name);
    await fs.writeFile(target, dump(merged, { lineWidth: 8000 }));
    written.push(target);
  }
  return written;
}

/**
 * Adds the Intel entries to a published macOS feed. The published arm64
 * entries, the compatibility pointer (an Apple silicon install that ignores
 * `files` must stay on its own build) and the release date are kept; the
 * Intel entries are checked against the built files. A retried run replaces
 * the Intel entries of an earlier attempt.
 */
export async function appendMacIntelFeed(publishedText, intelText, releaseFolder, expectedVersion) {
  const published = load(publishedText),
    intel = load(intelText);
  for (const [label, m] of [["published", published], ["Intel", intel]])
    if (m?.version !== expectedVersion) throw Error(`Mismatched ${label} feed version`);
  if (!/-arm64\.zip$/.test(published.path ?? "")) throw Error("The published feed must point to the arm64 ZIP");
  const isIntel = (url) => /^Nodus-Imago-mac-x64\.(zip|dmg)$/.test(url);
  const added = (intel.files ?? []).filter((f) => isIntel(f.url));
  for (const extension of ["zip", "dmg"])
    if (!added.some((f) => f.url === `Nodus-Imago-mac-x64.${extension}`)) throw Error("Missing Intel package " + extension);
  for (const f of added) {
    const file = path.join(releaseFolder, f.url),
      hash = createHash("sha512");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (f.sha512 !== hash.digest("base64") || (f.size !== undefined && f.size !== (await fs.stat(file)).size))
      throw Error("Artifact checksum/size mismatch " + f.url);
  }
  const kept = (published.files ?? []).filter((f) => !isIntel(f.url));
  if (!kept.some((f) => f.url === "Nodus-Imago-mac-arm64.zip")) throw Error("The published feed has no arm64 ZIP");
  return dump({ ...published, files: [...kept, ...added] }, { lineWidth: 8000 });
}
