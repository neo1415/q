import {
  Q_LANGUAGE_DIRECTION,
  type QLanguagePreference,
} from "@capital-q/contracts";

import { CORE_AR } from "./catalog/core";
import { DISCOVER_AR } from "./catalog/discover";
import { Q_AR } from "./catalog/q";

/**
 * The interface's language (multilingual Q, Arabic first, 2026-10-16).
 *
 * A minimal message catalogue, not a framework: the English source string
 * is the key and the fallback, so an untranslated string shows in English
 * rather than as a key, and adding a surface is adding lines here. Product
 * names (Capital Q, Q, GateQ, Q Pitch, The Q Daily) stay as they are in
 * every language. Only the person's saved choice changes the interface; an
 * Arabic device with nothing chosen still gets English screens (Q's voice
 * follows the device on its own).
 */
export type UiLanguage = "en" | "ar";

/**
 * Every area's Arabic, merged. An area adds `catalog/<area>.ts` and one
 * line here; the same English string means the same thing everywhere.
 */
const ARABIC: Readonly<Record<string, string>> = {
  ...CORE_AR,
  ...Q_AR,
  ...DISCOVER_AR,
};

export function uiLanguageOf(
  preference: QLanguagePreference | null | undefined,
): UiLanguage {
  return preference === "ar" ? "ar" : "en";
}

export function directionOf(language: UiLanguage): "ltr" | "rtl" {
  return Q_LANGUAGE_DIRECTION[language];
}

const CATALOGUE: Readonly<
  Record<UiLanguage, Readonly<Record<string, string>>>
> = { en: {}, ar: ARABIC };

/** The text in this language; the English source when there is none. */
export function translate(language: UiLanguage, english: string): string {
  return CATALOGUE[language][english] ?? english;
}

/** Strings this catalogue translates, for tests. */
export function translatedStrings(language: UiLanguage): readonly string[] {
  return Object.keys(CATALOGUE[language]);
}
