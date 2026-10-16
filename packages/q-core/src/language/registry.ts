import { canonicalLanguageTag } from "@capital-q/contracts";

/**
 * The language registry (owner directive 2026-10-16: "any language, and
 * change between any two"; no per-language code). Nothing here names a
 * language's behaviour: names come from the runtime's CLDR data
 * (Intl.DisplayNames, each language named in itself), writing direction
 * from Intl.Locale's text info (or, where a runtime lacks it, from the
 * script the locale is likely written in), and dates, numbers and lists
 * from Intl with the active locale.
 *
 * A tag is OFFERED when the runtime can name it and knows the script it
 * is written in: that excludes malformed tags, private codes and
 * languages CLDR only names (Klingon has a name but no script data), so
 * an unknown language is refused honestly instead of half-working.
 */

export type LanguageDirection = "ltr" | "rtl";

export type LanguageInfo = {
  /** Canonical BCP 47 tag. */
  readonly tag: string;
  /** Primary subtag ("pt" for "pt-BR"). */
  readonly primary: string;
  /** The language named in itself ("Kiswahili", "العربية"). */
  readonly nativeName: string;
  /** The language named in English ("Swahili"), for prompts and logs. */
  readonly englishName: string;
  /** ISO 15924 script it is likely written in ("Latn", "Arab"). */
  readonly script: string;
  readonly direction: LanguageDirection;
};

/**
 * Scripts written right to left (Unicode Script_Extensions, bidi class
 * R/AL). Used only where a runtime has no Intl.Locale text info.
 */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
  "Adlm",
  "Arab",
  "Aran",
  "Hebr",
  "Mand",
  "Mend",
  "Nkoo",
  "Rohg",
  "Samr",
  "Syrc",
  "Thaa",
  "Yezi",
]);

/**
 * The individual languages a person picks from: ISO 639-1, the codes
 * every runtime has names for. Data, not behaviour; any other well-formed
 * tag the runtime knows (a region, "fil", "yue") is accepted by `languageInfo`.
 */
export const ISO_639_1: readonly string[] = (
  "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy " +
  "da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht " +
  "hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky " +
  "la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny " +
  "oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss " +
  "st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo " +
  "za zh zu"
).split(" ");

type TextInfoLocale = Intl.Locale & {
  readonly getTextInfo?: () => { readonly direction?: string };
  readonly textInfo?: { readonly direction?: string };
};

function nameOf(tag: string, inLocale: string): string | undefined {
  try {
    const name = new Intl.DisplayNames([inLocale], {
      type: "language",
      fallback: "none",
    }).of(tag);
    return name === undefined || name.length === 0 || name === tag
      ? undefined
      : name;
  } catch {
    return undefined;
  }
}

function directionOfLocale(
  locale: Intl.Locale,
  script: string,
): LanguageDirection {
  const withInfo = locale as TextInfoLocale;
  try {
    const info =
      typeof withInfo.getTextInfo === "function"
        ? withInfo.getTextInfo()
        : withInfo.textInfo;
    if (info?.direction === "rtl" || info?.direction === "ltr") {
      return info.direction;
    }
  } catch {
    // Fall through to the script.
  }
  return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
}

const INFO = new Map<string, LanguageInfo | null>();

/** Everything the interface and Q need about a tag, or null when it is not offered. */
export function languageInfo(
  value: string | null | undefined,
): LanguageInfo | null {
  if (value === null || value === undefined) return null;
  const tag = canonicalLanguageTag(value);
  if (tag === null) return null;
  const cached = INFO.get(tag);
  if (cached !== undefined) return cached;
  let info: LanguageInfo | null = null;
  try {
    const locale = new Intl.Locale(tag);
    const script = locale.script ?? locale.maximize().script;
    const englishName = nameOf(tag, "en");
    if (script !== undefined && englishName !== undefined) {
      info = {
        tag,
        primary: locale.language,
        nativeName: nameOf(tag, tag) ?? englishName,
        englishName,
        script,
        direction: directionOfLocale(locale, script),
      };
    }
  } catch {
    info = null;
  }
  INFO.set(tag, info);
  return info;
}

export function isOfferedLanguage(value: string | null | undefined): boolean {
  return languageInfo(value) !== null;
}

/** Writing direction for a tag; left to right for anything unknown. */
export function languageDirection(
  value: string | null | undefined,
): LanguageDirection {
  return languageInfo(value)?.direction ?? "ltr";
}

/** True for English in any region: Q's and the catalogue's source language. */
export function isEnglish(value: string | null | undefined): boolean {
  return languageInfo(value)?.primary === "en";
}

let OFFERED: readonly LanguageInfo[] | null = null;

/** Every language the picker lists, by English name; each shows its own name. */
export function offeredLanguages(): readonly LanguageInfo[] {
  if (OFFERED === null) {
    OFFERED = ISO_639_1.map((code) => languageInfo(code))
      .filter((info): info is LanguageInfo => info !== null)
      .sort((a, b) => a.englishName.localeCompare(b.englishName, "en"));
  }
  return OFFERED;
}

/** The language named in the reader's language ("French" for an English reader). */
export function languageNameIn(
  value: string,
  readerLanguage: string,
): string | undefined {
  const tag = canonicalLanguageTag(value);
  return tag === null ? undefined : nameOf(tag, readerLanguage);
}

/**
 * Text folded for matching a language's name: lower case, no accents, no
 * Arabic-script definite article or feminine ending ("الفرنسية" and
 * "فرنسي" are the same word), no punctuation. Script rules, not language rules.
 */
function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ـ]/gu, "")
    .split(/\s+/u)
    .map((word) =>
      /\p{Script=Arabic}/u.test(word)
        ? word.replace(/^(?:ال|بال|لل)/u, "").replace(/(?:ية|ة|ي)$/u, "")
        : word,
    )
    .join(" ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
}

let NAMES: ReadonlyMap<string, string> | null = null;

/**
 * Every offered language's name in every offered language (and in
 * itself), folded, to its tag. Built once, lazily; CLDR does the work.
 */
function nameIndex(): ReadonlyMap<string, string> {
  if (NAMES !== null) return NAMES;
  const index = new Map<string, string>();
  const offered = offeredLanguages();
  const readers = offered.map((info) => info.tag);
  for (const reader of readers) {
    let names: Intl.DisplayNames;
    try {
      names = new Intl.DisplayNames([reader], {
        type: "language",
        fallback: "none",
      });
    } catch {
      continue;
    }
    for (const info of offered) {
      const name = names.of(info.tag);
      if (name === undefined || name === info.tag) continue;
      const key = fold(name);
      if (key.length >= 2 && !index.has(key)) index.set(key, info.tag);
    }
  }
  NAMES = index;
  return index;
}

export type LanguageResolution =
  | { readonly ok: true; readonly info: LanguageInfo }
  | { readonly ok: false; readonly reason: "UNKNOWN" | "NOT_OFFERED" };

/**
 * What a person asked for ("fr", "French", "français", "Kifaransa",
 * "الفرنسية", "pt-BR") as an offered language. A well-formed tag the
 * runtime cannot name or script is NOT_OFFERED; anything else not found
 * is UNKNOWN. Never guesses a language from a partial word.
 */
export function resolveLanguage(asked: string): LanguageResolution {
  const trimmed = asked.trim();
  if (trimmed.length === 0 || trimmed.length > 60) {
    return { ok: false, reason: "UNKNOWN" };
  }
  const asTag = canonicalLanguageTag(trimmed);
  if (asTag !== null) {
    const info = languageInfo(asTag);
    if (info !== null) return { ok: true, info };
  }
  const key = fold(trimmed);
  const tag = nameIndex().get(key);
  if (tag !== undefined) {
    const info = languageInfo(tag);
    if (info !== null) return { ok: true, info };
  }
  // A name the runtime knows for something it cannot script (Klingon).
  return {
    ok: false,
    reason: asTag !== null && nameOf(asTag, "en") !== undefined
      ? "NOT_OFFERED"
      : "UNKNOWN",
  };
}

/**
 * The comma a list is written with in this language's script: Arabic
 * script uses "، ", Chinese and Japanese "、", everything else ", ".
 */
export function listSeparator(value: string | null | undefined): string {
  const script = languageInfo(value)?.script;
  if (script === "Arab" || script === "Aran") return "، ";
  if (script === "Jpan" || script === "Hans" || script === "Hant") return "、";
  return ", ";
}
