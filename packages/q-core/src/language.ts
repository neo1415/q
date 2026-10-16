import type { QLanguageCode, QLanguagePreference } from "@capital-q/contracts";

/**
 * The language Q uses with a person (owner directive 2026-10-16, Arabic
 * first). One place decides it, so text, every voice line, rehearsals and
 * onboarding agree:
 *
 *   saved preference (Settings)  >  the device's language  >  English
 *
 * The prompt notes below are trusted product copy. They change the language
 * of what the person reads and hears, never the substance: names, figures,
 * currencies and investment terms stay exactly as recorded, and structured
 * output (JSON keys, codes, enum values) stays as its schema says.
 */

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

/** The locale a session should use: the saved choice wins over the device. */
export function effectiveLocale(
  preference: QLanguagePreference | null | undefined,
  deviceLocale: string | undefined,
): string | undefined {
  if (preference !== undefined && preference !== null && preference !== "AUTO")
    return preference;
  return deviceLocale !== undefined &&
    deviceLocale.length <= 35 &&
    LOCALE.test(deviceLocale)
    ? deviceLocale
    : undefined;
}

/** The supported language a locale means, or null for any other. */
export function supportedLanguageOf(
  locale: string | undefined,
): QLanguageCode | null {
  const primary = locale?.split("-")[0]?.toLowerCase();
  return primary === "ar" || primary === "en" ? primary : null;
}

const KEEP_EXACT =
  "Keep company names, people's names, product names, figures, dates, currency codes and amounts (USD 2.5m, AED, SAR, QAR) and established investment terms (ARR, MRR, SAFE, term sheet, pre-money, runway) exactly as recorded: never translate or transliterate a proper name, never convert a currency, and write numbers with Western digits (0-9).";

/**
 * The note for a written answer, placed with the person's other notes.
 * Null for English, or when nothing was chosen: Q then follows the
 * language they write in, as before.
 */
export function writtenLanguageNote(
  language: QLanguageCode | null | undefined,
): string | null {
  if (language !== "ar") return null;
  return `THEIR LANGUAGE: this person chose Arabic. Write everything they read in clear, professional Modern Standard Arabic (فصحى). If they write to you in another language, or ask you to switch, follow them. If they mix Arabic and English, answer in Arabic and keep the English terms they used. ${KEEP_EXACT} JSON keys, codes, enum values and identifiers stay exactly as the output format specifies; only the words meant for the person are Arabic.`;
}

/**
 * The note for a spoken line (voice, rehearsal, video). Null for English
 * or nothing chosen.
 */
export function spokenLanguageNote(
  language: QLanguageCode | null | undefined,
): string | null {
  if (language !== "ar") return null;
  return `Language: this person chose Arabic. Speak natural, clear Modern Standard Arabic, the register a Gulf professional uses at work, and understand Gulf and other Arabic dialects and Arabic-English code-switching. If they speak to you in English, or ask you to switch, follow them. Keep names, company names and investment terms as they say them (ARR, SAFE, term sheet). Say amounts as spoken Arabic with the currency named (USD, dirhams, riyals); never convert a currency.`;
}
