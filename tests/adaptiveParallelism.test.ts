import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Service } from "../electron/service";
import { AdaptiveParallelism, importParallelism } from "../electron/import/adaptiveParallelism";

/** A regulator driven by a fake clock, where `speed(level)` is the machine. */
function machine(speed: (level: number) => number, options: Partial<ConstructorParameters<typeof AdaptiveParallelism>[0]> = {}) {
  let now = 0,
    strain = { lagMs: 0, rssBytes: 0, othersShare: 0 };
  const regulator = new AdaptiveParallelism({
    max: 6,
    windowMs: 990,
    holdWindows: 3,
    memoryBudget: 1e9,
    clock: () => now,
    strain: () => strain,
    ...options,
  });
  return {
    regulator,
    setStrain(value: Partial<typeof strain>) {
      strain = { ...strain, ...value };
    },
    /** One measurement window at the current level; returns the level after it. */
    window(work = 1) {
      const level = regulator.level,
        items = 2 * level,
        perItem = 1000 / items;
      for (let i = 0; i < items; i++) {
        now += perItem;
        regulator.finished(work ? (speed(level) * 1000) / items : 0);
      }
      return regulator.level;
    },
  };
}

test("the regulator climbs while one more image pays off and stops where it no longer does", () => {
  // Throughput grows to four images at once, then the machine is saturated.
  const m = machine((level) => [0, 100, 180, 240, 280, 250, 230][level]);
  const levels = Array.from({ length: 9 }, () => m.window());
  assert.equal(m.regulator.level, 4, `levels ${levels}`);
  // Five was tried, found slower, and the ceiling is held at four.
  assert.ok(levels.includes(5));
  assert.equal(levels.at(-1), 4);
});

test("an import slower with one more image steps back, holds, then probes again", () => {
  let busy = false;
  // Another program takes the processor: past two images, more only slows down.
  const m = machine((level) => (busy ? [0, 100, 150, 110, 100, 90, 80] : [0, 100, 180, 240, 280, 250, 230])[level]);
  for (let i = 0; i < 6; i++) m.window();
  assert.equal(m.regulator.level, 4);
  busy = true;
  // At four the import is now slower than it was at three (measured before);
  // it keeps stepping back while fewer images go faster.
  for (let i = 0; i < 2; i++) m.window();
  assert.ok(m.regulator.level < 4, `level ${m.regulator.level}`);
  const held = m.regulator.level;
  for (let i = 0; i < 3; i++) assert.equal(m.window(), held, "the lowered ceiling is held");
  busy = false;
  // After the hold it probes again and climbs back to what pays.
  for (let i = 0; i < 7; i++) m.window();
  assert.equal(m.regulator.level, 4);
});

test("strain halves the images in flight: a stalled app, too much memory, an out-of-memory error", () => {
  const m = machine((level) => level * 100);
  for (let i = 0; i < 6; i++) m.window();
  assert.equal(m.regulator.level, 6);
  m.setStrain({ lagMs: 900 });
  m.window();
  assert.equal(m.regulator.level, 3);
  assert.equal(m.regulator.reason, "event loop stalled");
  m.setStrain({ lagMs: 0, rssBytes: 2e9 });
  m.window();
  assert.equal(m.regulator.level, 1);
  assert.equal(m.regulator.reason, "memory");

  const n = machine((level) => level * 100);
  for (let i = 0; i < 4; i++) n.window();
  const before = n.regulator.level;
  n.regulator.finished(0, new Error("VipsJpeg: out of memory"));
  assert.equal(n.regulator.level, Math.max(1, Math.floor(before / 2)));
  // An ordinary failure (an unreadable file) says nothing about the machine.
  n.regulator.finished(0, new Error("Input file is missing"));
  assert.equal(n.regulator.level, Math.max(1, Math.floor(before / 2)));
});

test("other programs keeping the processor busy make the import give way, but the app's own indexing does not", () => {
  const m = machine((level) => level * 100);
  for (let i = 0; i < 4; i++) m.window();
  assert.equal(m.regulator.level, 6);
  m.setStrain({ othersShare: 0.9 });
  assert.equal(m.window(), 5);
  assert.equal(m.regulator.reason, "busy machine");
  for (let i = 0; i < 6; i++) m.window();
  assert.equal(m.regulator.level, 1);
  m.setStrain({ othersShare: 0.1 });
  for (let i = 0; i < 20; i++) m.window();
  assert.equal(m.regulator.level, 6, "it climbs back once the machine is free");

  let indexing = true;
  const own = machine((level) => level * 100, { ownWork: () => indexing });
  own.setStrain({ othersShare: 0.9 });
  for (let i = 0; i < 4; i++) own.window();
  assert.equal(own.regulator.level, 6);
  indexing = false;
  own.window();
  assert.equal(own.regulator.level, 5);
});

test("a window with duplicates measures nothing and the profile bounds the maximum", () => {
  const m = machine((level) => level * 100);
  m.window(0);
  assert.equal(m.regulator.level, 2, "no decision on a window of duplicates");
  assert.equal(new AdaptiveParallelism({ max: 1, strain: () => ({ lagMs: 0, rssBytes: 0, othersShare: 0 }) }).level, 1);
  assert.ok(importParallelism("light") <= 2);
  assert.ok(importParallelism("balanced") <= 4);
  assert.ok(importParallelism("advanced") >= importParallelism("light"));
});

test("an import prepares images at once and records them in file order, without duplicates, across a pause", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "imago-parallel-")),
    service = new Service(path.join(root, "data"), "unused", () => {});
  try {
    const d = service.repo.create("Parallel"),
      files: string[] = [];
    for (let i = 0; i < 10; i++) {
      const file = path.join(root, `img-${String(i).padStart(2, "0")}.png`);
      await sharp({ create: { width: 32 + i, height: 24, channels: 3, background: { r: i * 20, g: 80, b: 160 } } })
        .png()
        .toFile(file);
      files.push(file);
    }
    // The same image twice in one import is recorded once.
    files.splice(5, 0, files[2]);
    const images = service.queue.images,
      prepare = images.prepareOne.bind(images);
    let active = 0,
      most = 0,
      gate: Promise<void> | null = null;
    images.prepareOne = async (payload, index) => {
      active++;
      most = Math.max(most, active);
      // Earlier files finish later, so completion order is scrambled.
      await new Promise((r) => setTimeout(r, (files.length - index) * 4));
      if (gate) await gate;
      try {
        return await prepare(payload, index);
      } finally {
        active--;
      }
    };
    service.queue.onRegulator = (regulator) => {
      regulator.level = 3;
    };
    const id = service.repo.newJob(
      "images",
      {
        databaseId: d.database.id,
        columnId: d.columns[1].id,
        storage: "copy",
        createUnmatched: true,
        files: files.map((p) => ({ path: p, rowId: null })),
      },
      files.length,
    );
    const job = () => service.repo.jobs().find((j) => j.id === id)!;
    // Pause once a few images are recorded; those in flight still finish.
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    service.queue.pump();
    const deadline = Date.now() + 5000;
    while (active < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    service.queue.control(id, "pause");
    open();
    gate = null;
    await service.queue.task;
    assert.equal(job().state, "paused");
    const paused = job().done;
    assert.ok(paused >= 1 && paused < files.length, `paused at ${paused}`);
    service.queue.control(id, "resume");
    await service.queue.task;
    assert.equal(job().state, "completed");
    assert.equal(job().done, files.length);
    assert.equal(job().skipped, 1, "the duplicate is skipped");
    assert.ok(most >= 2, `images were prepared at once (${most})`);
    const names = (
      service.repo.db
        .prepare(
          "SELECT a.file_name name FROM image_assets a JOIN db_rows r ON r.id=a.row_id WHERE a.database_id=? ORDER BY r.position",
        )
        .all(d.database.id) as { name: string }[]
    ).map((r) => r.name);
    assert.deepEqual(
      names,
      Array.from({ length: 10 }, (_, i) => `img-${String(i).padStart(2, "0")}.png`),
      "one record per image, in file order",
    );
  } finally {
    await service.run("_close");
    await fs.rm(root, { recursive: true, force: true });
  }
});
