// How many images an import prepares at once. Decoding an image and writing
// its previews keeps a core busy, so several at a time import faster, up to a
// point that depends on the machine, the images and what else it is doing.
// The regulator measures the throughput it gets (megapixels per second) and
// climbs one image at a time while that pays off. It steps back when one more
// image made the import slower, and halves when the machine shows strain: the
// app's event loop stalls (the window would stop responding), the process
// holds too much memory, or an image failed for lack of memory. When other
// programs keep the processor busy it gives way one image at a time, since
// taking more threads would only slow the researcher's other work. After
// backing off it holds that ceiling for a while, then tries again, since the
// load that caused it (another program, a huge batch of scans) may have passed.
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

export type Strain = {
  lagMs: number;
  rssBytes: number;
  /** Share of the whole processor used by other processes (0–1). */
  othersShare: number;
};

export type RegulatorOptions = {
  max: number;
  start?: number;
  /** A measurement lasts at least this long… */
  windowMs?: number;
  /** …and covers at least this many images per image in flight. */
  itemsPerLevel?: number;
  /** One more image in flight must raise throughput by this fraction. */
  gain?: number;
  /** Measurements a lowered ceiling is kept before probing again. */
  holdWindows?: number;
  /** Event-loop stall that counts as strain. */
  maxLagMs?: number;
  /** Process memory that counts as strain. */
  memoryBudget?: number;
  /** Share of the processor taken by other programs that counts as busy. */
  maxOthersShare?: number;
  /**
   * True while other work of this app (indexing in its own process) runs:
   * its processor use is not someone else's, so it does not count as busy.
   */
  ownWork?: () => boolean;
  clock?: () => number;
  /** Strain since the previous call. */
  strain?: () => Strain;
};

const cpuTimes = () =>
  os.cpus().reduce(
    (sum, cpu) => {
      const { user, nice, sys, irq, idle } = cpu.times;
      return { busy: sum.busy + user + nice + sys + irq, total: sum.total + user + nice + sys + irq + idle };
    },
    { busy: 0, total: 0 },
  );

/**
 * The default strain probe: event-loop delay, resident memory, and the share
 * of the processor that other processes use (all of it, less this process).
 */
export function processStrain() {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let cpus = cpuTimes(),
    self = process.cpuUsage();
  return {
    read(): Strain {
      // max is in nanoseconds; reset so each measurement sees its own window.
      const lagMs = histogram.max / 1e6;
      histogram.reset();
      const nowCpus = cpuTimes(),
        nowSelf = process.cpuUsage(self),
        total = nowCpus.total - cpus.total,
        busy = total > 0 ? (nowCpus.busy - cpus.busy) / total : 0,
        // cpuUsage is in microseconds of one core; os.cpus() in milliseconds
        // summed over every core.
        mine = total > 0 ? (nowSelf.user + nowSelf.system) / 1000 / total : 0;
      cpus = nowCpus;
      self = process.cpuUsage();
      return { lagMs, rssBytes: process.memoryUsage().rss, othersShare: Math.max(0, Math.min(1, busy - mine)) };
    },
    close: () => histogram.disable(),
  };
}

const OUT_OF_MEMORY = /out of memory|ENOMEM|cannot allocate|memory allocation/i;

export class AdaptiveParallelism {
  level: number;
  readonly max: number;
  private ceiling: number;
  private hold = 0;
  /** Last throughput measured at each level. */
  private measured = new Map<number, number>();
  private windowStart: number;
  private windowWork = 0;
  private windowItems = 0;
  /** A window with an image that cost no work (a duplicate) measures nothing. */
  private windowMixed = false;
  private options: Required<Omit<RegulatorOptions, "strain" | "start" | "max" | "ownWork">>;
  private ownWork: () => boolean;
  private probe?: ReturnType<typeof processStrain>;
  private strain: () => Strain;
  /** Why the level last changed, for logs and tests. */
  reason = "start";

  constructor(options: RegulatorOptions) {
    this.max = Math.max(1, Math.floor(options.max));
    this.level = Math.min(this.max, Math.max(1, options.start ?? 2));
    this.ceiling = this.max;
    this.options = {
      windowMs: options.windowMs ?? 3000,
      itemsPerLevel: options.itemsPerLevel ?? 2,
      gain: options.gain ?? 0.15,
      holdWindows: options.holdWindows ?? 10,
      maxLagMs: options.maxLagMs ?? 300,
      memoryBudget: options.memoryBudget ?? Math.max(1.5 * 2 ** 30, os.totalmem() * 0.3),
      maxOthersShare: options.maxOthersShare ?? 0.6,
      clock: options.clock ?? (() => performance.now()),
    };
    this.ownWork = options.ownWork ?? (() => false);
    if (options.strain) this.strain = options.strain;
    else {
      this.probe = processStrain();
      this.strain = this.probe.read;
    }
    this.windowStart = this.options.clock();
  }

  /** Images that may be in flight now. */
  limit() {
    return this.level;
  }

  /**
   * An image finished. `work` is its size in pixels, 0 for one that needed no
   * work (already imported); `error` is why it failed, if it did.
   */
  finished(work: number, error?: unknown) {
    if (error && OUT_OF_MEMORY.test(error instanceof Error ? error.message : String(error))) {
      this.backOff("memory error", Math.max(1, Math.floor(this.level / 2)));
      return;
    }
    if (work > 0) {
      this.windowWork += work;
      this.windowItems++;
    } else this.windowMixed = true;
    const elapsed = this.options.clock() - this.windowStart;
    if (elapsed < this.options.windowMs || this.windowItems < this.options.itemsPerLevel * this.level) return;
    const throughput = this.windowWork / elapsed,
      mixed = this.windowMixed,
      strain = this.strain();
    this.newWindow();
    if (strain.lagMs > this.options.maxLagMs) {
      this.backOff("event loop stalled", Math.max(1, Math.floor(this.level / 2)));
      return;
    }
    if (strain.rssBytes > this.options.memoryBudget) {
      this.backOff("memory", Math.max(1, Math.floor(this.level / 2)));
      return;
    }
    if (strain.othersShare > this.options.maxOthersShare && this.level > 1 && !this.ownWork()) {
      this.backOff("busy machine", this.level - 1);
      return;
    }
    // A lowered ceiling is kept for a while, then probed again.
    const holding = this.hold > 0;
    if (holding && --this.hold === 0) this.ceiling = this.max;
    if (mixed) return;
    const fewer = this.measured.get(this.level - 1),
      before = this.measured.get(this.level);
    this.measured.set(this.level, throughput);
    if (fewer !== undefined && throughput < fewer * (1 - this.options.gain / 2)) {
      // One image fewer went faster: the machine is saturated.
      this.backOff("slower", this.level - 1);
      return;
    }
    if (before !== undefined && throughput < before * 0.6 && this.level > 1) {
      // Much slower than this same level was: something else needs the
      // machine. Step back and measure again.
      this.measured.delete(this.level - 1);
      this.backOff("slower", this.level - 1);
      return;
    }
    const pays = fewer === undefined || throughput > fewer * (1 + this.options.gain);
    if (pays && !holding && this.level < Math.min(this.max, this.ceiling)) {
      this.level++;
      this.reason = "faster";
    }
  }

  close() {
    this.probe?.close();
  }

  private backOff(reason: string, level: number) {
    this.level = Math.max(1, Math.min(this.level, level));
    this.ceiling = this.level;
    this.hold = this.options.holdWindows;
    // Under strain, what was measured before no longer describes the machine.
    if (!["slower", "faster"].includes(reason)) this.measured.clear();
    this.reason = reason;
    this.newWindow();
  }

  private newWindow() {
    this.windowStart = this.options.clock();
    this.windowWork = 0;
    this.windowItems = 0;
    this.windowMixed = false;
  }
}

/** The most images an import may prepare at once on this machine. */
export function importParallelism(profile: "light" | "balanced" | "advanced") {
  const byProfile = profile === "light" ? 2 : profile === "balanced" ? 4 : 6,
    cores = Math.max(1, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 2)),
    // A very large image can take a few hundred MB while it is decoded.
    memory = Math.max(1, Math.floor((os.totalmem() / 2 ** 30 - 2) / 1.5));
  return Math.max(1, Math.min(byProfile, cores, memory));
}
