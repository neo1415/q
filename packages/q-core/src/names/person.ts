import { foldLatin, wordsOf } from "./script.js";
import { tokenize, tokenSimilarity, type NameToken } from "./tokens.js";

/**
 * Proper-name intelligence, step 4: comparing two PERSON names. The score
 * is name evidence only. A fuzzy match is never the same person: this
 * returns a graded score and the pieces behind it, and callers decide
 * with thresholds and corroborating evidence (see `resolve.ts`).
 */

const HONORIFICS = new Set([
  "sheikh",
  "shaikh",
  "sheik",
  "shaykh",
  "sheikha",
  "shaikha",
  "sheikhah",
  "mr",
  "mrs",
  "ms",
  "miss",
  "mx",
  "dr",
  "doctor",
  "eng",
  "engr",
  "engineer",
  "prof",
  "professor",
  "haj",
  "hajj",
  "haji",
  "hajji",
  "alhaji",
  "alhajji",
  "hajia",
  "hajiya",
  "chief",
  "hon",
  "amb",
  "ambassador",
  "his",
  "her",
  "excellency",
  "highness",
  "hh",
  "hrh",
  "sayyid",
  "sayed",
  "mallam",
  "malam",
  "ustaz",
  "ustadh",
  "captain",
  "capt",
  "colonel",
  "col",
  "gen",
  "general",
  "pastor",
  "rev",
  "imam",
  "sir",
  "madam",
  "شيخ",
  "شيخة",
  "دكتور",
  "دكتورة",
  "مهندس",
  "مهندسة",
  "سيد",
  "استاذ",
  "أستاذ",
  "حاج",
  "حاجة",
  "سمو",
  "معالي",
  "سعادة",
]);

/** Kinship particles: "son/daughter of". Lineage, not a name to match. */
const PARTICLES = new Set([
  "bin",
  "ibn",
  "ben",
  "bint",
  "binti",
  "bnt",
  "ould",
  "walad",
  "بن",
  "ابن",
  "بنت",
  "إبن",
]);

export type PersonName = {
  readonly raw: string;
  readonly honorifics: readonly string[];
  readonly tokens: readonly NameToken[];
  /** A "bin/ibn/bint" particle was present (lineage was stated). */
  readonly hadLineage: boolean;
};

const isHonorific = (word: string): boolean =>
  HONORIFICS.has(word) || HONORIFICS.has(foldLatin(word));
const isParticle = (word: string): boolean =>
  PARTICLES.has(word) || PARTICLES.has(foldLatin(word));

export function parsePersonName(raw: string): PersonName {
  const words = wordsOf(raw);
  const honorifics: string[] = [];
  const kept: string[] = [];
  let hadLineage = false;
  for (const word of words) {
    if (isParticle(word)) {
      hadLineage = true;
      continue;
    }
    // A title is a title only beside a name: a lone "Chief" is a name.
    if (words.length > 1 && isHonorific(word)) {
      honorifics.push(word);
      continue;
    }
    kept.push(word);
  }
  return { raw, honorifics, tokens: tokenize(kept.join(" ")), hadLineage };
}

/** Below this a pair of words is not treated as the same name part. */
export const PAIR_FLOOR = 0.72;

export type NameGrade = "CANONICAL" | "VARIANT" | "POSSIBLE" | "WEAK" | "NONE";

export type NameMatch = {
  /** 0..1 name evidence only. Not a probability of same person. */
  readonly score: number;
  readonly grade: NameGrade;
  /** Parts of the shorter name that found a partner in the longer. */
  readonly matchedParts: number;
  readonly queryParts: number;
  readonly recordParts: number;
  /** One part only: a given or family name alone identifies nobody. */
  readonly partial: boolean;
};

const NONE: NameMatch = {
  score: 0,
  grade: "NONE",
  matchedParts: 0,
  queryParts: 0,
  recordParts: 0,
  partial: false,
};

export function gradeOf(score: number): NameGrade {
  if (score >= 0.99) return "CANONICAL";
  if (score >= 0.85) return "VARIANT";
  if (score >= 0.7) return "POSSIBLE";
  if (score >= 0.5) return "WEAK";
  return "NONE";
}

/** Greedy best one-to-one pairing of the parts of two names. */
export function pairTokens(
  left: readonly NameToken[],
  right: readonly NameToken[],
): readonly {
  readonly li: number;
  readonly ri: number;
  readonly sim: number;
}[] {
  const all: { li: number; ri: number; sim: number }[] = [];
  left.forEach((l, li) =>
    right.forEach((r, ri) => {
      const sim = tokenSimilarity(l, r);
      if (sim >= PAIR_FLOOR) all.push({ li, ri, sim });
    }),
  );
  all.sort((a, b) => b.sim - a.sim);
  const usedL = new Set<number>();
  const usedR = new Set<number>();
  const chosen: typeof all = [];
  for (const pair of all) {
    if (usedL.has(pair.li) || usedR.has(pair.ri)) continue;
    usedL.add(pair.li);
    usedR.add(pair.ri);
    chosen.push(pair);
  }
  return chosen;
}

export function scoreTokens(
  query: readonly NameToken[],
  record: readonly NameToken[],
  options: { readonly allowSingle?: boolean } = {},
): NameMatch {
  if (query.length === 0 || record.length === 0) return NONE;
  const shorter = Math.min(query.length, record.length);
  const longer = Math.max(query.length, record.length);
  const pairs = pairTokens(query, record);
  const total = pairs.reduce((sum, pair) => sum + pair.sim, 0);
  let score = total / shorter;
  // Unmatched parts of the longer name (a middle name) cost a little.
  score *= 1 - 0.04 * (longer - shorter);
  const allMatched = pairs.length === shorter;
  // A part of the shorter name with no partner means a different person
  // (Shadi Qishta / Samer Qishta): never above "weak".
  if (!allMatched) score = Math.min(score, 0.45);
  const partial = shorter === 1 && longer > 1;
  // A single shared word identifies nobody.
  if (partial && options.allowSingle !== true) score = Math.min(score, 0.6);
  score = Math.max(0, Math.min(1, score));
  return {
    score,
    grade: gradeOf(score),
    matchedParts: pairs.length,
    queryParts: query.length,
    recordParts: record.length,
    partial,
  };
}

/** Name evidence between a said or typed person name and a recorded one. */
export function scorePersonNames(query: string, record: string): NameMatch {
  return scoreTokens(
    parsePersonName(query).tokens,
    parsePersonName(record).tokens,
  );
}
