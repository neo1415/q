import {
  languageDirectionOf,
  type QLanguagePreference,
} from "@capital-q/contracts";
import { languageInfo, listSeparator } from "@capital-q/q-core/language";

import { indexPatterns, localiseDate, matchPattern } from "./patterns";

/**
 * The interface's language (owner directive 2026-10-16: any language, and
 * switch between any two; no per-language code).
 *
 * A minimal message catalogue, not a framework: the English source string
 * is the key and the fallback, so an untranslated string shows in English
 * rather than as a key. A language's words come from, in order:
 *
 *   1. its hand-written catalogue, when one exists (Arabic today), which
 *      always wins;
 *   2. the machine translations Q made of the same English catalogue
 *      (UI_TRANSLATION, cached server-side and registered here by the
 *      layout), until then nothing;
 *   3. English.
 *
 * Direction, dates and lists come from Intl for the language; product
 * names (Capital Q, Q, GateQ, Q Pitch, The Q Daily) stay as they are.
 * Only the person's saved choice changes the interface; a device language
 * with nothing chosen still gets English screens (Q's voice follows the
 * device on its own).
 */
/** A canonical BCP 47 tag ("en", "ar", "fr", "pt-BR"). */
export type UiLanguage = string;

/**
 * The languages with a hand-written catalogue, by primary subtag. W4-A
 * (audit finding 6): the catalogues themselves load on demand
 * (`loadHandCatalogue`), so an English page no longer ships the whole
 * Arabic catalogue; the server registers them at start (./hand-server),
 * and the language provider loads the one it needs before it renders.
 */
const HAND_LANGUAGES: ReadonlySet<string> = new Set(["ar"]);

/** Hand-written catalogues by primary subtag, once loaded. They win over machine output. */
const HAND = new Map<string, Readonly<Record<string, string>>>();

/** A hand catalogue, as loaded (the server at start, the browser on demand). */
export function registerHandCatalogue(
  language: UiLanguage,
  entries: Readonly<Record<string, string>>,
): void {
  const primary = primaryOf(language);
  if (HAND.get(primary) === entries) return;
  HAND.set(primary, entries);
  for (const key of [...PATTERNS.keys()]) {
    if (primaryOf(key) === primary) PATTERNS.delete(key);
  }
}

/** Whether this language's hand catalogue is ready to translate with (true for none needed). */
export function handCatalogueReady(language: UiLanguage): boolean {
  const primary = primaryOf(language);
  return (
    !HAND_LANGUAGES.has(primary) || HAND.has(primary) || UNLOADABLE.has(primary)
  );
}

/** A catalogue whose chunk failed to load: its screens stay English, never broken. */
const UNLOADABLE = new Set<string>();

const LOADING = new Map<string, Promise<void>>();

/** Loads (once) and registers this language's hand catalogue; resolved at once when none is needed. */
export function loadHandCatalogue(language: UiLanguage): Promise<void> {
  const primary = primaryOf(language);
  if (handCatalogueReady(primary)) return Promise.resolve();
  const loading =
    LOADING.get(primary) ??
    import("./arabic").then(
      (module) => {
        registerHandCatalogue(primary, module.ARABIC);
      },
      () => {
        UNLOADABLE.add(primary);
      },
    );
  LOADING.set(primary, loading);
  return loading;
}

const EMPTY: Readonly<Record<string, string>> = {};

/** Machine translations by tag, registered by the layout (shared product copy). */
const MACHINE = new Map<string, Readonly<Record<string, string>>>();

const primaryOf = (language: UiLanguage): string =>
  (language.split("-")[0] ?? language).toLowerCase();

/** The language the interface uses: the saved choice when the registry offers it, else English. */
/**
 * The interface language. A saved language is that language; Automatic
 * (or none saved) follows the device (QO-45, QA 2026-10-23: Automatic on
 * an ar-EG browser rendered English): the first of the device's languages
 * the interface has, by exact tag and then by its primary language,
 * else English.
 */
export function uiLanguageOf(
  preference: QLanguagePreference | null | undefined,
  device: string | readonly string[] | null = null,
): UiLanguage {
  if (preference === null || preference === undefined || preference === "AUTO")
    return deviceLanguageOf(device);
  return languageInfo(preference)?.tag ?? "en";
}

/** "ar-EG,ar;q=0.9,en;q=0.8" or navigator.languages, to a language we have. */
export function deviceLanguageOf(
  device: string | readonly string[] | null,
): UiLanguage {
  if (device === null) return "en";
  const tags =
    typeof device === "string"
      ? device
          .split(",")
          .map((part) => {
            const [tag = "", ...params] = part.trim().split(";");
            const q = params
              .map((param) => /^\s*q=([\d.]+)\s*$/u.exec(param)?.[1])
              .find((value) => value !== undefined);
            return { tag: tag.trim(), q: q === undefined ? 1 : Number(q) };
          })
          .filter((entry) => entry.tag.length > 0 && entry.q > 0)
          .sort((a, b) => b.q - a.q)
          .map((entry) => entry.tag)
      : device;
  for (const tag of tags.slice(0, 12)) {
    // English in any region is the interface's own text, never a translation.
    if (/^en(?:-|$)/iu.test(tag)) return "en";
    const exact = languageInfo(tag)?.tag;
    if (exact !== undefined) return exact;
    const primary = languageInfo(tag.split("-")[0] ?? "")?.tag;
    if (primary !== undefined) return primary;
  }
  return "en";
}

export function directionOf(language: UiLanguage): "ltr" | "rtl" {
  return languageDirectionOf(language);
}

/** Whether a language has a hand-written catalogue (its screens are fully hand-translated). */
export function hasHandCatalogue(language: UiLanguage): boolean {
  return HAND_LANGUAGES.has(primaryOf(language));
}

/**
 * Q's machine translations for a language, as the server served them.
 * Called by the language provider (browser) and the server layouts.
 */
export function registerMachineCatalogue(
  language: UiLanguage,
  entries: Readonly<Record<string, string>>,
): void {
  const current = MACHINE.get(language);
  if (current === entries) return;
  if (
    current !== undefined &&
    Object.keys(current).length >= Object.keys(entries).length
  ) {
    // Never shrink what is already shown: a slower, older response loses.
    return;
  }
  MACHINE.set(language, entries);
  PATTERNS.delete(language);
}

type Layered = {
  readonly catalogue: Readonly<Record<string, string>>;
  readonly patterns: ReturnType<typeof indexPatterns>;
};

const PATTERNS = new Map<string, Layered>();

/** The language's merged catalogue (machine under hand) and its pattern index, cached. */
function layered(language: UiLanguage): Layered {
  const cached = PATTERNS.get(language);
  if (cached !== undefined) return cached;
  const catalogue = {
    ...(MACHINE.get(language) ?? EMPTY),
    ...(HAND.get(primaryOf(language)) ?? EMPTY),
  };
  const built = { catalogue, patterns: indexPatterns(catalogue) };
  PATTERNS.set(language, built);
  return built;
}

/**
 * The text in this language; the English source when there is none. A
 * sentence with a name or figure in it matches a `{placeholder}` key.
 */
export function translate(language: UiLanguage, english: string): string {
  if (primaryOf(language) === "en") return english;
  const { catalogue, patterns } = layered(language);
  return (
    catalogue[english] ??
    matchPattern(patterns, catalogue, english, language) ??
    localiseDate(english, language, catalogue) ??
    translateList(language, catalogue, english) ??
    english
  );
}

/**
 * A list a screen joined itself ("Financial Services, Fintech"): in the
 * language only when every item has a translation, joined with that
 * script's comma; a list with any unknown item (a name, say) stays exactly
 * as written.
 */
function translateList(
  language: UiLanguage,
  catalogue: Readonly<Record<string, string>>,
  english: string,
): string | undefined {
  if (!english.includes(", ")) return undefined;
  const parts = english.split(", ");
  const translated = parts.map((part) => catalogue[part]);
  return translated.every((part): part is string => part !== undefined)
    ? translated.join(listSeparator(language))
    : undefined;
}

/** Strings this language's catalogue translates (hand and machine), for tests. */
export function translatedStrings(language: UiLanguage): readonly string[] {
  return Object.keys(layered(language).catalogue);
}
