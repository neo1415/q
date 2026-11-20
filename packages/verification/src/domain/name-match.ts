/**
 * V1: the deterministic name matcher (research §6.2 step 3): never a model.
 * Names are normalised (case, accents, punctuation, titles, the register's
 * "SURNAME, Given" order) and compared as sets of name parts.
 *
 *   MATCH     two or more parts agree and one name's parts all appear in
 *             the other ("Ada Example" and "EXAMPLE, Ada Ngozi")
 *   PARTIAL   some parts agree, or agree only within one typing slip: a
 *             person decides
 *   NO_MATCH  nothing agrees
 */
export type NameMatch = "MATCH" | "PARTIAL" | "NO_MATCH";

const TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "prof",
  "sir",
  "dame",
  "lady",
  "lord",
  "chief",
  "alhaji",
  "alhaja",
  "engr",
  "hon",
  "rev",
  "barr",
  "jr",
  "sr",
  "ii",
  "iii",
]);

export function nameParts(name: string): readonly string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]+/gu, " ")
    .replace(/['-]+/gu, "")
    .split(/\s+/u)
    .filter((part) => part.length > 0 && !TITLES.has(part));
}

/** At most one edit apart (one letter added, dropped or changed). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function matchNames(left: string, right: string): NameMatch {
  const a = new Set(nameParts(left));
  const b = new Set(nameParts(right));
  if (a.size === 0 || b.size === 0) return "NO_MATCH";
  const exact = [...a].filter((part) => b.has(part));
  const smaller = a.size <= b.size ? a : b;
  if (
    exact.length === smaller.size &&
    (exact.length >= 2 || (a.size === 1 && b.size === 1))
  ) {
    return "MATCH";
  }
  if (exact.length > 0) return "PARTIAL";
  const near = [...a].filter(
    (part) =>
      part.length >= 4 &&
      [...b].some((other) => other.length >= 4 && oneEditApart(part, other)),
  );
  return near.length > 0 ? "PARTIAL" : "NO_MATCH";
}
