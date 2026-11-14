// Groups of values that are probably the same thing written differently:
// "Nicolás Muller", "Muller, Nicolás", "N. Muller", "Nicolas Müller".
// The rules follow the ones catalogue cleaning tools use (OpenRefine's key
// collision and nearest neighbour), kept conservative: dates and numbers that
// differ are never grouped, and the person decides every merge.

export type ValueCount = { value: string; optionId: string | null; count: number };
export type ValueCluster = {
  /** "same": identical once case, accents, punctuation and word order are ignored. */
  kind: "same" | "similar";
  members: ValueCount[];
  /** The most used form, or the most complete one on a tie. */
  suggestion: string;
};

// Accents are ignored, but ñ stays a letter of its own (Osuna is not Osuña).
const plain = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0000/g, "ñ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** Same key: same words, whatever their case, accents, punctuation or order. */
export const fingerprint = (s: string) => [...new Set(plain(s).split(" ").filter(Boolean))].sort().join(" ");

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** "n muller" and "muller nicolas": the same words, some reduced to an initial. */
function initials(a: string[], b: string[]) {
  if (a.length !== b.length || a.length < 2) return false;
  const rest = [...b];
  const pending: string[] = [];
  for (const word of a) {
    const i = rest.indexOf(word);
    if (i >= 0) rest.splice(i, 1);
    else pending.push(word);
  }
  if (!pending.length || pending.length === a.length) return false;
  for (const word of pending) {
    const i = rest.findIndex((other) => (word.length === 1 && other.startsWith(word)) || (other.length === 1 && word.startsWith(other)));
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

/**
 * Two keys close enough to be the same name written differently: some words
 * reduced to initials, or one word with a slip of one letter (two in a long
 * word of at least seven letters). The slip never changes the first letter: Valencia and Palencia, Mérida and Lérida, Fondo A and Fondo B stay
 * apart.
 */
export function similarKeys(a: string, b: string): boolean {
  if (a === b) return true;
  // Different numbers are different things ("1950" and "1951", "Fondo 3" and "Fondo 4").
  const digits = (s: string) => s.replace(/\D+/g, " ").trim();
  if (digits(a) !== digits(b)) return false;
  const wa = a.split(" "),
    wb = b.split(" ");
  if (wa.length !== wb.length) return false;
  if (initials(wa, wb)) return true;
  const onlyA = wa.filter((w) => !wb.includes(w)),
    onlyB = wb.filter((w) => !wa.includes(w));
  if (onlyA.length !== 1 || onlyB.length !== 1) return false;
  const [x, y] = [onlyA[0], onlyB[0]];
  if (x[0] !== y[0] || Math.min(x.length, y.length) < 7) return false;
  return distance(x, y) <= (Math.min(x.length, y.length) >= 10 ? 2 : 1);
}

const better = (a: ValueCount, b: ValueCount) => b.count - a.count || b.value.length - a.value.length || a.value.localeCompare(b.value);

export function clusterValues(values: ValueCount[]): ValueCluster[] {
  const byKey = new Map<string, ValueCount[]>();
  for (const v of values) {
    const key = fingerprint(v.value);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), v]);
  }
  // Keys joined to a representative (the most used), never in chains. Only
  // keys that share a word or the start of a word are compared; long texts
  // (paths, descriptions) are grouped only when equal.
  const total = (k: string) => byKey.get(k)!.reduce((s, v) => s + v.count, 0);
  const keys = [...byKey.keys()].sort((a, b) => total(b) - total(a) || a.localeCompare(b));
  const rank = new Map(keys.map((k, i) => [k, i]));
  const comparable = (k: string) => k.length <= 80 && k.split(" ").length <= 8;
  const index = new Map<string, string[]>();
  const handles = (k: string) => k.split(" ").flatMap((w) => [w, "^" + w.slice(0, 2)]);
  for (const key of keys)
    if (comparable(key)) for (const h of new Set(handles(key))) index.set(h, [...(index.get(h) ?? []), key]);
  const groups: string[][] = [];
  const taken = new Set<string>();
  for (const key of keys) {
    if (taken.has(key)) continue;
    const group = [key];
    taken.add(key);
    if (comparable(key)) {
      const candidates = new Set<string>();
      for (const h of new Set(handles(key))) for (const other of index.get(h) ?? []) candidates.add(other);
      for (const other of [...candidates].sort((a, b) => rank.get(a)! - rank.get(b)!))
        if (!taken.has(other) && similarKeys(key, other)) {
          group.push(other);
          taken.add(other);
        }
    }
    groups.push(group);
  }
  const clusters: ValueCluster[] = [];
  for (const group of groups) {
    const members = group.flatMap((k) => byKey.get(k)!).sort(better);
    if (members.length < 2) continue;
    clusters.push({ kind: group.length === 1 ? "same" : "similar", members, suggestion: members[0].value });
  }
  return clusters.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "same" ? -1 : 1) || b.members.length - a.members.length);
}
