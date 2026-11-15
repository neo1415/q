/**
 * A firm's name from what its own website states, never a page title as it
 * came (GateQ brand from website, live defects 2026-11-14: Stripe read as
 * "Stripe | Financiële infrastructuur…", Flutterwave as "Endless
 * possibilities for every business - Flutterwave").
 *
 * Pure and deterministic: no network, nothing sent to a model. Each
 * statement is tried in order of how directly the site names itself; a
 * statement with separators is split, and the segment that is the
 * site's own domain label wins ("stripe" for stripe.com), else the
 * shortest segment that reads like a name. A marketing sentence is never
 * a name: when nothing credible is left the caller reports NOT_FOUND.
 */

export type WebsiteNameSource =
  | "OG_SITE_NAME"
  | "APPLICATION_NAME"
  | "MANIFEST"
  | "SCHEMA_ORG"
  | "LOGO_LABEL"
  | "TITLE";

/** A brand name is short; anything longer is a sentence about it. */
export const BRAND_NAME_MAX = 60;
const BRAND_WORDS_MAX = 6;
/** A segment that matched nothing must read like a name, not a phrase. */
const LOOSE_WORDS_MAX = 4;

/** Title separators: " | ", " – ", " — ", " - ", ": ", " · ". */
const SEPARATOR = /\s*[|·–—]\s*|\s+-\s+|:\s+/u;

/** Words that make a phrase, not a name, in the languages sites answer in. */
const PHRASE_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "to",
  "with",
  "your",
  "our",
  "every",
  "in",
  "on",
  "is",
  "are",
  "we",
  "you",
  "voor",
  "de",
  "het",
  "een",
  "für",
  "und",
  "die",
  "der",
  "pour",
  "les",
  "des",
  "et",
  "para",
  "con",
  "y",
  "el",
  "la",
]);

/** Page names that are never a firm's name. */
const GENERIC = new Set([
  "home",
  "homepage",
  "home page",
  "welcome",
  "index",
  "official site",
  "official website",
  "website",
  "untitled",
  "main page",
  "start",
  "logo",
]);

const squash = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/**
 * The registrable domain's own label: "stripe" for www.stripe.com and
 * stripe.com/nl, "flutterwave" for flutterwave.com, "acme" for acme.co.uk.
 */
export function domainLabel(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/\.$/u, "")
    .split(".")
    .filter((part) => part.length > 0);
  if (parts.length < 2) return parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const second = parts[parts.length - 2] ?? "";
  if (parts.length >= 3 && last.length === 2 && SECOND_LEVEL.has(second)) {
    return parts[parts.length - 3] ?? "";
  }
  return second;
}

const wordsOf = (text: string) =>
  text.split(/\s+/u).filter((word) => word.length > 0);

const isGeneric = (text: string) =>
  GENERIC.has(
    text
      .toLowerCase()
      .replace(/[.!]+$/u, "")
      .trim(),
  );

/** Reads like a name a firm calls itself, matched to the domain or not. */
function nameShaped(text: string, maxWords: number): boolean {
  if (text.length < 2 || text.length > BRAND_NAME_MAX) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (isGeneric(text)) return false;
  // A sentence ends; a name does not.
  if (
    /[.!?]$/u.test(text) &&
    !/\b(?:inc|ltd|co|corp|llc|plc|gmbh|ag|sa|bv|nv)\.$/iu.test(text)
  ) {
    return false;
  }
  return wordsOf(text).length <= maxWords;
}

const hasPhraseWords = (text: string) =>
  wordsOf(text).some((word) =>
    PHRASE_WORDS.has(word.toLowerCase().replace(/[^\p{L}]/gu, "")),
  );

/** The site's own label is in it ("Stripe", "Flutterwave Inc"). */
function matchesLabel(segment: string, label: string): boolean {
  if (label.length < 3) return false;
  const squashed = squash(segment);
  return (
    squashed.includes(label) ||
    (squashed.length >= 3 && label.startsWith(squashed))
  );
}

/**
 * The name in one statement ("Stripe | Payments" is Stripe, "Endless
 * possibilities for every business - Flutterwave" is Flutterwave), or
 * null when it holds no credible name.
 */
export function brandNameOf(
  statement: string | null,
  label: string,
  options: { readonly whole?: boolean } = {},
): string | null {
  if (statement === null) return null;
  const text = statement.replace(/\s+/gu, " ").trim();
  if (text.length === 0) return null;
  const segments = text
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  // A statement that is itself a name (og:site_name "Kilima Angels &
  // Partners") is kept whole when it is short and has no separators.
  if (
    options.whole === true &&
    segments.length <= 1 &&
    nameShaped(text, BRAND_WORDS_MAX) &&
    (matchesLabel(text, label) || !hasPhraseWords(text))
  ) {
    return text;
  }
  const matched = segments.filter(
    (segment) =>
      matchesLabel(segment, label) && nameShaped(segment, BRAND_WORDS_MAX),
  );
  if (matched.length > 0) {
    return [...matched].sort((a, b) => a.length - b.length)[0] ?? null;
  }
  const loose = segments.filter(
    (segment) =>
      nameShaped(segment, LOOSE_WORDS_MAX) && !hasPhraseWords(segment),
  );
  if (loose.length === 0) return null;
  // One segment that is not the domain is only a name when it stands
  // alone (a title "Kilima"); among several, the shortest name-like one.
  return [...loose].sort((a, b) => a.length - b.length)[0] ?? null;
}

/** "Stripe logo", "Go to Linear home" → "Stripe", "Linear". */
export function logoLabelName(label: string | null): string | null {
  if (label === null) return null;
  const stripped = label
    .replace(/\b(?:go\s+to|back\s+to|return\s+to|visit)\b/giu, " ")
    .replace(/\b(?:logo(?:type)?|wordmark|home\s*page|homepage|home)\b/giu, " ")
    .replace(/[\s'’]s\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return stripped.length === 0 ? null : stripped;
}

export type NameStatement = {
  readonly from: WebsiteNameSource;
  readonly value: string | null;
};

export type ChosenName =
  | {
      readonly status: "FOUND";
      readonly value: string;
      readonly from: WebsiteNameSource;
    }
  | {
      readonly status: "NOT_FOUND";
      readonly reason: "NO_NAME" | "NAME_NOT_CREDIBLE";
    };

/**
 * The first statement, in order, that holds a credible name. NO_NAME when
 * the site states none; NAME_NOT_CREDIBLE when it states only phrases.
 */
export function chooseWebsiteName(
  statements: readonly NameStatement[],
  host: string,
): ChosenName {
  const label = domainLabel(host);
  let stated = false;
  for (const statement of statements) {
    if (statement.value === null || statement.value.trim().length === 0) {
      continue;
    }
    stated = true;
    const value = brandNameOf(statement.value, label, {
      whole: statement.from !== "TITLE",
    });
    if (value !== null) return { status: "FOUND", value, from: statement.from };
  }
  return {
    status: "NOT_FOUND",
    reason: stated ? "NAME_NOT_CREDIBLE" : "NO_NAME",
  };
}
