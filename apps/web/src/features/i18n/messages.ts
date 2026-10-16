import {
  Q_LANGUAGE_DIRECTION,
  type QLanguagePreference,
} from "@capital-q/contracts";

import { ADMIN_AR } from "./catalog/admin";
import { COMPANY_AR } from "./catalog/company";
import { CORE_AR } from "./catalog/core";
import { DAILY_AR } from "./catalog/daily";
import { DISCOVER_AR } from "./catalog/discover";
import { DOCUMENTS_AR } from "./catalog/documents";
import { GATEQ_AR } from "./catalog/gateq";
import { Q_AR } from "./catalog/q";
import { RELATIONSHIPS_AR } from "./catalog/relationships";
import { SETUP_AR } from "./catalog/setup";
import { SHELL_AR } from "./catalog/shell";
import { WORK_AR } from "./catalog/work";
import { indexPatterns, localiseDate, matchPattern } from "./patterns";

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
  ...RELATIONSHIPS_AR,
  ...DOCUMENTS_AR,
  ...GATEQ_AR,
  ...WORK_AR,
  ...DAILY_AR,
  ...ADMIN_AR,
  ...Q_AR,
  ...DISCOVER_AR,
  ...COMPANY_AR,
  ...SETUP_AR,
  ...SHELL_AR,
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

const PATTERNS = { en: indexPatterns({}), ar: indexPatterns(ARABIC) };

/**
 * The text in this language; the English source when there is none. A
 * sentence with a name or figure in it matches a `{placeholder}` key.
 */
export function translate(language: UiLanguage, english: string): string {
  const catalogue = CATALOGUE[language];
  return (
    catalogue[english] ??
    matchPattern(PATTERNS[language], catalogue, english) ??
    (language === "ar" ? localiseDate(english) : undefined) ??
    english
  );
}

/** Strings this catalogue translates, for tests. */
export function translatedStrings(language: UiLanguage): readonly string[] {
  return Object.keys(CATALOGUE[language]);
}
