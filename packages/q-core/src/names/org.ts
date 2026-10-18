import { foldLatin, wordsOf } from "./script.js";
import { gradeOf, scoreTokens, type NameMatch } from "./person.js";
import { tokenize, type NameToken } from "./tokens.js";

/**
 * Proper-name intelligence, step 5: ORGANISATION names. "Midmac
 * Contracting Company W.L.L." and "Midmac" are one brand. The legal form
 * (W.L.L., LLC, Co.) and generic descriptors (Contracting, Trading,
 * Group) are set aside; the brand words decide. Name evidence only.
 */

const LEGAL_FORMS = new Set([
  "wll",
  "llc",
  "llp",
  "lp",
  "ltd",
  "limited",
  "plc",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "sarl",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "pty",
  "pte",
  "qsc",
  "qpsc",
  "qpjsc",
  "pjsc",
  "psc",
  "jsc",
  "fze",
  "fzco",
  "fzc",
  "fz",
  "dmcc",
  "est",
  "establishment",
  "sa",
  "sas",
  "spa",
  "cv",
  "شركة",
  "شذمم",
  "ذمم",
  "مساهمة",
  "محدودة",
  "المحدودة",
  "مؤسسة",
  "ش",
  "ذم",
]);

const DESCRIPTORS = new Set([
  "contracting",
  "contractors",
  "contractor",
  "contract",
  "trading",
  "trade",
  "general",
  "group",
  "holding",
  "holdings",
  "international",
  "intl",
  "engineering",
  "construction",
  "constructions",
  "services",
  "service",
  "enterprises",
  "enterprise",
  "industries",
  "industrial",
  "the",
  "and",
  "for",
  "of",
  "projects",
  "technical",
  "technology",
  "technologies",
  "solutions",
  "investment",
  "investments",
  "development",
  "developments",
  "real",
  "estate",
  "مقاولات",
  "للمقاولات",
  "المقاولات",
  "تجارة",
  "للتجارة",
  "والتجارة",
  "مجموعة",
  "القابضة",
  "العالمية",
  "الدولية",
  "والمقاولات",
  "للتجارة",
]);

const PLACES_IN_NAMES = new Set([
  "qatar",
  "doha",
  "nigeria",
  "lagos",
  "abuja",
  "uae",
  "dubai",
  "abudhabi",
  "saudi",
  "ksa",
  "kuwait",
  "bahrain",
  "oman",
  "gulf",
  "mena",
  "africa",
  "قطر",
  "الدوحة",
]);

export type OrgName = {
  readonly raw: string;
  /** Brand words that decide identity. */
  readonly brand: readonly NameToken[];
  readonly legalForms: readonly string[];
  readonly descriptors: readonly string[];
};

/** "W.L.L." -> "WLL"; "L L C" -> "LLC": dotted or spaced initials join. */
function joinInitials(text: string): string {
  const dotted = text.replace(
    /(?<![\p{L}\p{N}])(?:\p{L}\.){2,}\p{L}?/gu,
    (run) => run.replace(/\./gu, ""),
  );
  return dotted.replace(
    /(?<![\p{L}\p{N}])(?:\p{L}\s){1,}\p{L}(?![\p{L}\p{N}])/gu,
    (run) => run.replace(/\s/gu, ""),
  );
}

const keyOf = (word: string): string =>
  /[؀-ۿ]/u.test(word) ? word : foldLatin(word);

export function parseOrgName(raw: string): OrgName {
  const words = wordsOf(joinInitials(raw.replace(/&/gu, " and ")));
  const legalForms: string[] = [];
  const descriptors: string[] = [];
  const brand: string[] = [];
  for (const word of words) {
    const key = keyOf(word);
    if (LEGAL_FORMS.has(key)) legalForms.push(key);
    else if (DESCRIPTORS.has(key) || PLACES_IN_NAMES.has(key)) {
      descriptors.push(key);
    } else brand.push(word);
  }
  // A name made only of descriptors keeps them: it is all it has.
  const decisive =
    brand.length > 0 ? brand : words.filter((w) => !LEGAL_FORMS.has(keyOf(w)));
  return {
    raw,
    brand: tokenize(decisive.join(" ")),
    legalForms,
    descriptors: brand.length > 0 ? descriptors : [],
  };
}

/** Name evidence between a said organisation name and a recorded one. */
export function scoreOrgNames(query: string, record: string): NameMatch {
  const a = parseOrgName(query);
  const b = parseOrgName(record);
  const base = scoreTokens(a.brand, b.brand, { allowSingle: true });
  if (base.score === 0) return base;
  // An org brand is usually one word, so one shared word IS the brand when
  // both sides are that one word; "Midmac" against "Midmac Gulf Projects"
  // is only a possible match.
  let score =
    a.brand.length === b.brand.length ? base.score : Math.min(base.score, 0.7);
  const mine = new Set(a.descriptors.map(descriptorRoot));
  const theirs = new Set(b.descriptors.map(descriptorRoot));
  const bothSay = mine.size > 0 && theirs.size > 0;
  const shared = [...mine].some((one) => theirs.has(one));
  // "Midmac Trading" is not "Midmac Contracting", but is the same brand.
  if (bothSay && !shared) score *= 0.9;
  else if (
    mine.size !== theirs.size &&
    !(mine.size === 0 || theirs.size === 0)
  ) {
    score *= 0.98;
  }
  score = Math.max(0, Math.min(1, score));
  return { ...base, score, grade: gradeOf(score), partial: false };
}

function descriptorRoot(word: string): string {
  if (word.startsWith("contract")) return "contracting";
  if (word.startsWith("construct")) return "construction";
  if (word === "intl") return "international";
  if (word.startsWith("holding")) return "holding";
  return word;
}
