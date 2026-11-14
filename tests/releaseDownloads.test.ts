// Download counters for the README table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyInstaller, latestRelease, sumDownloads } from "../scripts/release-downloads.mjs";

test("every installer counts in its row; feeds and blockmaps do not count", () => {
  assert.equal(classifyInstaller("Nodus-Imago-mac-arm64.dmg"), "macosArm64");
  assert.equal(classifyInstaller("Nodus-Imago-mac-arm64.zip"), "macosArm64");
  assert.equal(classifyInstaller("Nodus-Imago-mac-x64.dmg"), "macosIntel");
  assert.equal(classifyInstaller("Nodus-Imago-win-x64.exe"), "windows");
  assert.equal(classifyInstaller("Nodus-Imago-linux-amd64.deb"), "linuxDeb");
  assert.equal(classifyInstaller("Nodus-Imago-linux-arm64.deb"), "linuxDeb");
  assert.equal(classifyInstaller("Nodus-Imago-linux-aarch64.rpm"), "linuxRpm");
  assert.equal(classifyInstaller("Nodus-Imago-linux-x86_64.AppImage"), "linuxAppImage");
  for (const other of ["latest-mac.yml", "beta-linux.yml", "Nodus-Imago-win-x64.exe.blockmap", "notes.txt", null])
    assert.equal(classifyInstaller(other as string), null);
});

test("totals add every published release; the latest column counts only the newest stable one", () => {
  const asset = (name: string, download_count: number) => ({ name, download_count });
  const releases = [
    { tag_name: "v0.2.0-beta.1", prerelease: true, published_at: "2026-12-10T00:00:00Z", assets: [asset("Nodus-Imago-win-x64.exe", 5)] },
    { tag_name: "v0.1.1", published_at: "2026-12-01T00:00:00Z", assets: [asset("Nodus-Imago-mac-arm64.dmg", 3), asset("latest-mac.yml", 99)] },
    { tag_name: "v0.1.0", published_at: "2026-11-14T00:00:00Z", assets: [asset("Nodus-Imago-mac-arm64.dmg", 10), asset("Nodus-Imago-linux-amd64.deb", 2)] },
    { tag_name: "v0.3.0", draft: true, assets: [asset("Nodus-Imago-win-x64.exe", 50)] },
  ];
  assert.equal(latestRelease(releases)!.tag_name, "v0.1.1");
  const counts = sumDownloads(releases);
  assert.equal(counts.total, 20);
  assert.equal(counts.installers.macosArm64, 13);
  assert.equal(counts.installers.windows, 5);
  assert.deepEqual({ version: counts.latest.version, total: counts.latest.total, mac: counts.latest.installers.macosArm64 }, { version: "v0.1.1", total: 3, mac: 3 });
});
