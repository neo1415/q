import { languageInfo } from "@capital-q/q-core/language";

/**
 * The language of Q's onboarding reply (lane ml, ob1 live acceptance on
 * AF: a French turn and an Arabic turn were saved, and Q answered in
 * English). One rule, for every language:
 *
 *   the person's chosen language  >  (Automatic) the language of the turn
 *
 * English is the only language code writes its own words in (a quick
 * acknowledgement, a "saved" line, the next question appended); in any
 * other language those are put in it through the shared translation
 * layer when the language is known by its tag, or left to the model,
 * which is told to answer in the language of their latest words.
 */
export type ReplyLanguage =
  | { readonly kind: "ENGLISH" }
  /** Their chosen language, by its tag. */
  | { readonly kind: "CHOSEN"; readonly tag: string }
  /** Automatic, and the turn is not in English: answer in theirs. */
  | { readonly kind: "THEIRS" };

/**
 * Small words nearly every English sentence has. Used only to tell
 * whether a turn is English (the one language code writes in), never to
 * name any other language.
 */
const ENGLISH_WORDS = new Set(
  `a an the and or but if so of to in on at by for with from about as is are
  was were be been am do does did have has had i i'm i've we we're our us my
  me you your it it's its they them their this that these those there here
  what which who how when where why yes no not yeah yep nope ok okay sure
  just about around per each one two three four five six seven eight nine
  ten hundred thousand million billion please thanks thank can will would
  could should may might must also only still very more most less than then
  now today currently already`.split(/\s+/u),
);

/**
 * Whether a turn is in English, or carries no language of its own (a
 * figure, a name, a list of names): then the default stands. A turn in a
 * script other than Latin is not English.
 */
export function turnIsEnglish(utterance: string): boolean {
  const letters = utterance.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const latin = utterance.match(/\p{Script=Latin}/gu) ?? [];
  if (latin.length < letters.length * 0.6) return false;
  // Only lower-case words say anything about the language: capitalised
  // words are names as often as not ("Rimal Freight, Dubai, seed").
  const words = (utterance.match(/[\p{L}']+/gu) ?? [])
    .filter((word) => word === word.toLowerCase())
    .map((word) => word.replace(/'+$/u, ""));
  if (words.length <= 2) return true;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  return english >= 1 && english / words.length >= 0.15;
}

/** The reply's language for this turn. */
export function replyLanguageOf(
  chosen: string | null,
  utterance: string,
): ReplyLanguage {
  if (chosen !== null) {
    const info = languageInfo(chosen);
    if (info !== null) {
      return info.primary === "en"
        ? { kind: "ENGLISH" }
        : { kind: "CHOSEN", tag: info.tag };
    }
  }
  return turnIsEnglish(utterance) ? { kind: "ENGLISH" } : { kind: "THEIRS" };
}

/** Told to the interviewer when Automatic meets a turn not in English. */
export const FOLLOW_THEIR_LANGUAGE_NOTE =
  "THEIR LANGUAGE: their latest words are not in English. Write your whole reply in the language of their latest words, including every question, and end with the next question in that language; the steps and notes you are given are in English. Keep company names, people's names, figures, dates and currency codes exactly as recorded. If they switch to English, follow them.";
