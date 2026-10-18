/**
 * Matching a name as the person said or the recogniser heard it to the
 * names Capital Q holds (moved from q-tools' connection requests so the
 * answer seam resolves names the same way the tools do; live 2026-10-02:
 * "TALUM" for Tallyloom). Pure; no dictionary, no list of words.
 */

export function comparable(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Edit distance, for a name heard slightly wrong ("Kazuki" for "Kazikit"). */
export function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(
        current + 1,
        (row[j - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * A name as it sounds: letters only, vowels (and y) dropped, repeats
 * collapsed, first letter kept. "TALUM" and "Tallyloom" both read "tlm";
 * "Kazuki" and "Kazikit" read "kzk" and "kzkt". A rough ear for a name
 * heard or typed slightly wrong, never a dictionary.
 */
export function nameSkeleton(name: string): string {
  const letters = comparable(name).replace(/[^\p{L}]+/gu, "");
  if (letters.length === 0) return "";
  const head = letters.charAt(0);
  const rest = letters.slice(1).replace(/[aeiouy]/g, "");
  return (head + rest).replace(/(.)\1+/g, "$1");
}

/**
 * The items the words name, closest tier first: the id, the exact name,
 * a name containing or contained in it, a small edit distance, then a
 * name that sounds the same. Every item of the first tier that matches is
 * returned, so several equally close names can be asked about; never a
 * guess among them, and never an item from a weaker tier when a stronger
 * one matched.
 */
export function closestByName<T>(
  items: readonly T[],
  said: string,
  nameOf: (item: T) => string,
  idOf?: (item: T) => string,
): readonly T[] {
  if (idOf !== undefined) {
    const byId = items.filter((item) => idOf(item) === said.trim());
    if (byId.length > 0) return byId;
  }
  const wanted = comparable(said);
  if (wanted.length === 0) return [];
  const tiers: readonly ((name: string) => boolean)[] = [
    (name) => name === wanted,
    (name) => name.includes(wanted) || wanted.includes(name),
    (name) =>
      name.length >= 4 &&
      distance(name, wanted) <=
        Math.max(1, Math.floor(Math.min(name.length, wanted.length) / 3)),
    (name) => {
      const a = nameSkeleton(name);
      const b = nameSkeleton(wanted);
      return (
        a.length >= 3 &&
        b.length >= 3 &&
        a.charAt(0) === b.charAt(0) &&
        distance(a, b) <= 1
      );
    },
  ];
  for (const tier of tiers) {
    const found = items.filter((item) => {
      const name = comparable(nameOf(item));
      return name.length > 0 && tier(name);
    });
    if (found.length > 0) return found;
  }
  return [];
}
