/**
 * D1: the wake words, the one fixed phrase list Capital Q allows (founder
 * rule J7 exception). "Hey Q", "Hello Q", "Hi Q", "OK Q".
 *
 * The detector that shipped (ADR 0058) reads a short transcript from the
 * browser's speech recogniser, so a phrase is matched on words, not on
 * sound. A recogniser writes the letter Q as "Q", "cue", "queue" or "kew";
 * those spellings are accepted, nothing else. "you", "view", "few" and
 * "cool" sound close and are deliberately absent: "hey you" is the most
 * common false wake for this phrase. No edit distance on the Q word for
 * the same reason ("cue" and "you" are one letter apart).
 */

export const WAKE_WORDS_VERSION = "2026-10-06.1";

export const WAKE_PHRASES = [
  { id: "HEY_Q", label: "Hey Q", greetings: ["hey", "hay", "hei", "heya"] },
  {
    id: "HELLO_Q",
    label: "Hello Q",
    greetings: ["hello", "hallo", "hullo", "helo"],
  },
  { id: "HI_Q", label: "Hi Q", greetings: ["hi", "hiya", "hai"] },
  { id: "OK_Q", label: "OK Q", greetings: ["ok", "okay", "okey", "okie"] },
] as const;

export type WakePhraseId = (typeof WAKE_PHRASES)[number]["id"];

const Q_WORDS: readonly string[] = ["q", "cue", "queue", "kew", "kyu", "kue"];

/** Lower case, "o.k." as "ok", letters and digits only, single spaces. */
export function normaliseTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bo\.?\s?k\.?(?=\s|$|[,!?])/g, "ok")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function greetingOf(word: string): WakePhraseId | null {
  for (const phrase of WAKE_PHRASES) {
    if ((phrase.greetings as readonly string[]).includes(word)) {
      return phrase.id;
    }
  }
  return null;
}

/** "heyq", "okcue": a recogniser sometimes writes the two words as one. */
function joined(word: string): WakePhraseId | null {
  for (const phrase of WAKE_PHRASES) {
    for (const greeting of phrase.greetings) {
      if (!word.startsWith(greeting)) continue;
      if (Q_WORDS.includes(word.slice(greeting.length))) return phrase.id;
    }
  }
  return null;
}

/**
 * The wake phrase said in `transcript`, or null. The greeting and the Q
 * word must be next to each other; anything may come before or after
 * ("Hey Q, show me the top three").
 */
export function matchWakePhrase(transcript: string): WakePhraseId | null {
  const words = normaliseTranscript(transcript).split(" ");
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? "";
    const together = joined(word);
    if (together !== null) return together;
    const greeting = greetingOf(word);
    if (greeting !== null && Q_WORDS.includes(words[i + 1] ?? "")) {
      return greeting;
    }
  }
  return null;
}

/** What Q says first after a wake word (D1): short, no round-trip to compose. */
export const WAKE_GREETING = "Hi — what can I do?";
