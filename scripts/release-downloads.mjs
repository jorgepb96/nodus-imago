// Download counters of the GitHub releases, for the README table, by the
// method of Nodus Research (scripts/github-release-downloads.mjs): one row per
// package the README offers, all releases and the latest one apart. The
// download-stats workflow writes the result to the download-stats branch,
// where the README badges read it; main is never written.
import fs from "node:fs/promises";
import path from "node:path";

export const REPOSITORY = "jorgepb96/nodus-imago";
/** One per row of the README download table. */
export const INSTALLER_KEYS = ["macosArm64", "macosIntel", "windows", "linuxDeb", "linuxRpm", "linuxAppImage"];

const token = (lower, t) => new RegExp(`(?:^|[-_.])${t}(?:[-_.]|$)`).test(lower);

/**
 * The row of an uploaded release file, or null for files that are not
 * installers (update feeds, blockmaps). A macOS build counts as its DMG and
 * as the ZIP the updater downloads by itself, as in Nodus.
 */
export function classifyInstaller(name) {
  if (typeof name !== "string") return null;
  const lower = name.toLowerCase();
  if (/^(latest|beta).*\.ya?ml$/.test(lower) || lower.endsWith(".blockmap")) return null;
  if (lower.endsWith(".deb")) return "linuxDeb";
  if (lower.endsWith(".rpm")) return "linuxRpm";
  if (lower.endsWith(".appimage")) return "linuxAppImage";
  if (lower.endsWith(".exe")) return "windows";
  if (!lower.endsWith(".dmg") && !lower.endsWith(".zip")) return null;
  if (token(lower, "x64") || token(lower, "intel")) return "macosIntel";
  if (token(lower, "arm64") || token(lower, "aarch64")) return "macosArm64";
  return null;
}

const empty = () => ({ total: 0, installers: Object.fromEntries(INSTALLER_KEYS.map((k) => [k, 0])) });
function add(counts, release) {
  for (const asset of Array.isArray(release?.assets) ? release.assets : []) {
    const downloads = Number(asset?.download_count);
    const row = classifyInstaller(asset?.name);
    if (!row || !Number.isFinite(downloads) || downloads < 0) continue;
    counts.installers[row] += downloads;
    counts.total += downloads;
  }
}

/** The release that "releases/latest/download/…" resolves to: newest published, not a prerelease. */
export function latestRelease(releases) {
  let latest = null,
    time = -Infinity;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || r.prerelease) continue;
    const t = Date.parse(r.published_at ?? r.created_at ?? "");
    if (latest === null || (Number.isFinite(t) ? t : -Infinity) > time) [latest, time] = [r, Number.isFinite(t) ? t : -Infinity];
  }
  return latest;
}

export function sumDownloads(releases) {
  const all = empty();
  for (const r of Array.isArray(releases) ? releases : []) if (r && !r.draft) add(all, r);
  const newest = latestRelease(releases),
    latest = empty();
  if (newest) add(latest, newest);
  return { ...all, latest: { ...latest, version: typeof newest?.tag_name === "string" ? newest.tag_name : null } };
}

export async function fetchReleases({ fetchImpl = fetch, token: auth = process.env.GITHUB_TOKEN } = {}) {
  const releases = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "nodus-imago-download-counter",
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
    });
    if (!response.ok) throw Error(`GitHub releases: HTTP ${response.status}`);
    const batch = await response.json();
    releases.push(...batch);
    if (!/rel="next"/.test(response.headers.get("link") ?? "")) break;
  }
  return releases;
}

/** Writes the counters and appends a dated line to the history. */
export async function writeSnapshot(folder, releases, now = new Date()) {
  const counts = { updatedAt: now.toISOString(), ...sumDownloads(releases) };
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, "github-release-downloads.json");
  await fs.writeFile(file + ".tmp", JSON.stringify(counts, null, 2) + "\n");
  await fs.rename(file + ".tmp", file);
  // GitHub keeps only running totals: the history shows when a counter moved.
  const assets = releases
    .filter((r) => r && !r.draft)
    .flatMap((r) => (r.assets ?? []).filter((a) => classifyInstaller(a.name)).map((a) => [r.tag_name, a.name, a.download_count]));
  await fs.appendFile(path.join(folder, "history.jsonl"), JSON.stringify({ at: counts.updatedAt, total: counts.total, assets }) + "\n");
  return counts;
}
