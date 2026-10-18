/**
 * A name the person said, resolved against the names on their own records
 * (founder live 2026-09-27, failure 6).
 *
 * Speech-to-text wrote "Zener Aviation" for the company the person owns,
 * recorded as "Zino Aviation" / "ZINO AVIATION LTD"; Q researched the
 * misheard name and found nothing. Before a spoken name is researched it is
 * compared with the names Capital Q already holds for this person — their
 * own company's canonical and legal names, their own firm, their own name —
 * and, when it is close to exactly one of them, the recorded one is used.
 *
 * The comparison is over NAMES FROM RECORDS, never over the person's
 * phrasing: nothing here decides what a sentence meant (ADR 0011). A model
 * reads which company the person is talking about; this only checks
 * whether the name it read is one of theirs, misheard. A name that is not
 * near any record stays the name it is; two records equally near is no
 * answer (unknown stays unknown).
 */

export type OwnRecordKind = "OWN_COMPANY" | "OWN_FIRM" | "OWN_PERSON";

/** The names on the person's own records, each list as recorded. */
export type OwnRecordNames = {
  readonly company: {
    readonly companyId: string;
    readonly names: readonly string[];
  } | null;
  readonly firm: { readonly names: readonly string[] } | null;
  readonly person: { readonly names: readonly string[] } | null;
};

export const NO_OWN_RECORDS: OwnRecordNames = {
  company: null,
  firm: null,
  person: null,
};

export type OwnRecordMatch = {
  readonly kind: OwnRecordKind;
  /** The name as recorded: what research and the document use. */
  readonly recordedName: string;
  readonly exact: boolean;
};

/**
 * Legal-form words: part of how a company is registered, not of what it is
 * called ("ZINO AVIATION LTD" is "Zino Aviation"). A normalisation of
 * company names, applied to both sides.
 */
const LEGAL_FORMS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "lp",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "sas",
  "sarl",
  "bv",
  "nv",
  "pty",
  "pte",
  "corp",
  "corporation",
  "co",
  "company",
  "the",
]);

export function nameTokens(name: string): readonly string[] {
  return (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((token) => !LEGAL_FORMS.has(token));
}

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] ?? 0;
      const left = previous[j - 1] ?? 0;
      previous[j] = Math.min(
        above + 1,
        left + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

/**
 * A consonant skeleton of one word as it sounds in English: letters that
 * sound alike share a symbol, vowels after the first letter drop, and an
 * "r" after a vowel at the end drops (a non-rhotic "Zener" and "Zino" are
 * both /ziːn…/). An initial "x" is a "z" ("Xeno"). Deliberately small: it
 * only has to say whether a recogniser could have heard one for the other.
 */
export function soundKey(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return "";
  w = w
    .replace(/^x/, "z")
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/dg/g, "j")
    .replace(/v/g, "f")
    .replace(/z/g, "s");
  if (w.length > 2 && VOWELS.has(w.at(-2) ?? "") && w.endsWith("r")) {
    w = w.slice(0, -1);
  }
  const first = w[0] ?? "";
  let key = VOWELS.has(first) ? "a" : first;
  for (const letter of w.slice(1)) {
    if (VOWELS.has(letter) || letter === "h" || letter === "w") continue;
    if (key.at(-1) !== letter) key += letter;
  }
  return key;
}

type Pair = "EXACT" | "CLOSE" | "SOUNDS_ALIKE" | "DIFFERENT";

function comparePair(said: string, recorded: string): Pair {
  if (said === recorded) return "EXACT";
  const longest = Math.max(said.length, recorded.length);
  const ratio = editDistance(said, recorded) / longest;
  const key = soundKey(said);
  const recordedKey = soundKey(recorded);
  // One letter off is close only when the word still starts with the same
  // sound: "Zeno" for "Zino" is a mishearing, "Kino" is another name.
  if (longest >= 4 && ratio <= 1 / 3 && key[0] === recordedKey[0]) {
    return "CLOSE";
  }
  if (key.length >= 2 && key === recordedKey && ratio <= 0.6) {
    return "SOUNDS_ALIKE";
  }
  return "DIFFERENT";
}

/** How near a said name is to one recorded name; null when not near. */
function nearness(said: string, recorded: string): number | null {
  const s = nameTokens(said);
  const r = nameTokens(recorded);
  // The said name is the recorded one or its leading words ("Zino" for
  // "Zino Aviation"); a trailing or middle word alone ("Aviation") is a
  // different name.
  if (s.length === 0 || s.length > r.length) return null;
  const pairs = s.map((token, index) => comparePair(token, r[index] ?? ""));
  if (pairs.includes("DIFFERENT")) return null;
  const exact = pairs.filter((pair) => pair === "EXACT").length;
  // A sound-alike word counts only beside a word that matches outright:
  // "Zener Aviation" is "Zino Aviation"; "Zener" alone is not enough.
  if (pairs.includes("SOUNDS_ALIKE") && exact === 0) return null;
  const score = pairs.reduce(
    (sum, pair) => sum + (pair === "EXACT" ? 3 : pair === "CLOSE" ? 2 : 1),
    0,
  );
  return score + (s.length === r.length ? 1 : 0);
}

/**
 * The one own record a said name refers to, as recorded, or null.
 * Ties between different records are null: never guess which.
 */
export function resolveOwnRecord(
  said: string,
  records: OwnRecordNames,
): OwnRecordMatch | null {
  const candidates: { kind: OwnRecordKind; names: readonly string[] }[] = [
    ...(records.company === null
      ? []
      : [{ kind: "OWN_COMPANY" as const, names: records.company.names }]),
    ...(records.firm === null
      ? []
      : [{ kind: "OWN_FIRM" as const, names: records.firm.names }]),
    ...(records.person === null
      ? []
      : [{ kind: "OWN_PERSON" as const, names: records.person.names }]),
  ];
  let best: (OwnRecordMatch & { score: number }) | null = null;
  let tied = false;
  for (const candidate of candidates) {
    let top: { score: number; name: string } | null = null;
    for (const name of candidate.names) {
      const score = nearness(said, name);
      if (score !== null && (top === null || score > top.score)) {
        top = { score, name };
      }
    }
    if (top === null) continue;
    if (best === null || top.score > best.score) {
      best = {
        kind: candidate.kind,
        recordedName: candidate.names[0] ?? top.name,
        exact: sameTokens(said, top.name),
        score: top.score,
      };
      tied = false;
    } else if (top.score === best.score) {
      tied = true;
    }
  }
  if (best === null || tied) return null;
  return {
    kind: best.kind,
    recordedName: best.recordedName,
    exact: best.exact,
  };
}

function sameTokens(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  return (
    left.length === right.length &&
    left.every((token, index) => token === right[index])
  );
}
