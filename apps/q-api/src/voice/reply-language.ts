import { languageInfo, textIsEnglish } from "@capital-q/q-core/language";

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
 * Whether a turn is in English, or carries no language of its own (moved
 * to q-core so the answer path shares it).
 */
export const turnIsEnglish = textIsEnglish;

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
