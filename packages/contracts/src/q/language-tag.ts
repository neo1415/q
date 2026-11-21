/**
 * W4-B (enterprise audit finding 6): language tags without the schema
 * library. Moved from ./conduct.ts unchanged, so the browser's root
 * layout (direction, the language event) ships no zod; conduct.ts
 * re-exports these, and its schemas use them.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

/** The canonical form of a BCP 47 tag ("PT-br" -> "pt-BR"), or null when malformed. */
export function canonicalLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 35) return null;
  try {
    const canonical = Intl.getCanonicalLocales(trimmed)[0];
    return canonical !== undefined &&
      canonical.length <= 35 &&
      LANGUAGE_TAG.test(canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
}

/**
 * Scripts written right to left (Unicode bidi class R/AL). Used only where
 * a runtime has no Intl.Locale text info.
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

type TextInfoLocale = Intl.Locale & {
  readonly getTextInfo?: () => { readonly direction?: string };
  readonly textInfo?: { readonly direction?: string };
};

/**
 * Writing direction of a tag, from the runtime's own data: Intl.Locale's
 * text info where the runtime has it, else the script the locale is
 * likely written in. Left to right for anything unknown. No language is
 * named here: Arabic, Urdu, Hebrew, Dhivehi and every other right-to-left
 * language come out of the same lookup.
 */
export function languageDirectionOf(
  value: string | null | undefined,
): "ltr" | "rtl" {
  if (value === null || value === undefined) return "ltr";
  const tag = canonicalLanguageTag(value);
  if (tag === null) return "ltr";
  try {
    const locale = new Intl.Locale(tag) as TextInfoLocale;
    const info =
      typeof locale.getTextInfo === "function"
        ? locale.getTextInfo()
        : locale.textInfo;
    if (info?.direction === "rtl" || info?.direction === "ltr")
      return info.direction;
    const script = locale.script ?? locale.maximize().script;
    return script !== undefined && RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}

/**
 * The same check as `QLanguagePreferenceSchema` (conduct.ts), by hand:
 * "AUTO", or a canonical BCP 47 tag of 2 to 35 characters. Kept in step
 * by a test that compares the two on the same inputs.
 */
export function isQLanguagePreference(
  value: unknown,
): value is "AUTO" | (string & {}) {
  if (value === "AUTO") return true;
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 35 &&
    canonicalLanguageTag(value) === value
  );
}
