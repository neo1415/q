import type { QLanguageCode, QLanguagePreference } from "@capital-q/contracts";

import { languageInfo } from "./language/registry.js";

/**
 * The language Q uses with a person (owner directive 2026-10-16: any
 * language). One place decides it, so text, every voice line, rehearsals and
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

/**
 * The offered language a locale means (its canonical tag, region kept:
 * "ar-AE", "en-US"), or null for nothing or a tag the registry does not
 * offer.
 */
export function supportedLanguageOf(
  locale: string | undefined,
): QLanguageCode | null {
  const info = languageInfo(locale);
  return info === null ? null : info.tag;
}

/** The language named for a prompt: "Swahili (Kiswahili)", "Arabic (العربية)". */
function promptName(language: QLanguageCode): string | null {
  const info = languageInfo(language);
  if (info === null || info.primary === "en") return null;
  return info.nativeName === info.englishName
    ? info.englishName
    : `${info.englishName} (${info.nativeName})`;
}

const KEEP_EXACT =
  "Keep company names, people's names, product names, figures, dates, currency codes and amounts (USD 2.5m, AED, SAR, QAR) and established investment terms (ARR, MRR, SAFE, term sheet, pre-money, runway) exactly as recorded: never translate or transliterate a proper name, never convert a currency, and write numbers with Western digits (0-9).";

/**
 * The note for a written answer, placed with the person's other notes.
 * Null for English, or when nothing was chosen: Q then follows the
 * language they write in, as before. One sentence for every language.
 */
export function writtenLanguageNote(
  language: QLanguageCode | null | undefined,
): string | null {
  const name =
    language === null || language === undefined ? null : promptName(language);
  if (name === null) return null;
  return `THEIR LANGUAGE: this person chose ${name}. Write everything they read in clear, professional ${name}, in the standard written form professionals use at work. If they write to you in another language, or ask you to switch, follow them. If they mix it with English, answer in their language and keep the English terms they used. ${KEEP_EXACT} JSON keys, codes, enum values and identifiers stay exactly as the output format specifies; only the words meant for the person are in their language.`;
}

/**
 * The note for a spoken line (voice, rehearsal, video). Null for English
 * or nothing chosen.
 */
export function spokenLanguageNote(
  language: QLanguageCode | null | undefined,
): string | null {
  const name =
    language === null || language === undefined ? null : promptName(language);
  if (name === null) return null;
  return `Language: this person chose ${name}. Speak natural, clear ${name}, the standard register a professional uses at work, and understand regional accents and dialects and their mixing with English. If they speak to you in another language, or ask you to switch, follow them. Keep names, company names and investment terms as they say them (ARR, SAFE, term sheet). Say amounts in spoken words with the currency named; never convert a currency.`;
}
