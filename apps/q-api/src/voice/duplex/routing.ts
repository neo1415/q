/**
 * Who answers a finished turn on a routed duplex line (VOICE-BRAIN,
 * founder live 2026-10-08).
 *
 * On 2026-10-08 09:59-10:01 UTC one duplex call ran a single ask_q: every
 * other thing the founder said was answered by the realtime model on its
 * own, without Q's records, documents or tools. That is where "I can't
 * open files" and the know-nothing answers came from. The realtime model
 * is the voice, never the brain: this code, not the model, decides.
 *
 * Deterministic and deliberately narrow: only an utterance made entirely
 * of greeting, acknowledgement, thanks, farewell or filler words is small
 * talk the voice may answer. Everything else -- any question, any noun,
 * any "can you open my deck" -- goes to Q. A miss costs a little latency
 * (Q answers small talk); the opposite miss costs the person's trust.
 */

export type DuplexTurnRoute = "ASK_Q" | "SMALLTALK" | "MODEL";

/** The routed= value in the per-turn log line and the transcript store. */
export type DuplexRoutedAs = "ask_q" | "smalltalk" | "model_only";

export const routedAs = (route: DuplexTurnRoute): DuplexRoutedAs =>
  route === "ASK_Q"
    ? "ask_q"
    : route === "SMALLTALK"
      ? "smalltalk"
      : "model_only";

/** Words that, on their own, carry no request (English; any case). */
const TRIVIAL = new Set([
  // greetings and address
  "hi",
  "hello",
  "hey",
  "hiya",
  "there",
  "q",
  "good",
  "morning",
  "afternoon",
  "evening",
  "yo",
  // acknowledgements and continuers
  "ok",
  "okay",
  "k",
  "yeah",
  "yes",
  "yep",
  "yup",
  "ya",
  "sure",
  "right",
  "alright",
  "all",
  "mm",
  "mmm",
  "hmm",
  "mhm",
  "uh",
  "huh",
  "um",
  "er",
  "ah",
  "oh",
  "wow",
  "cool",
  "great",
  "nice",
  "perfect",
  "awesome",
  "lovely",
  "fine",
  "fair",
  "enough",
  "sounds",
  "really",
  "indeed",
  "exactly",
  "true",
  "of",
  "course",
  "no",
  "nope",
  "nah",
  "so",
  "and",
  "well",
  "i",
  // thanks and farewells
  "thanks",
  "thank",
  "you",
  "cheers",
  "appreciate",
  "bye",
  "goodbye",
  "later",
  "talk",
  "soon",
  "take",
  "care",
  // "I'm good, you?"
  "i'm",
  "im",
  "too",
  "also",
]);

/**
 * Phrases that are trivial only as a whole: "can", "see" or "it" alone
 * belong to real questions ("can you see it?", "open it").
 */
const TRIVIAL_PHRASES = [
  "how are you doing",
  "how are you",
  "how's it going",
  "hows it going",
  "how is it going",
  "are you there",
  "you there",
  "still with me",
  "got it",
  "i see",
  "can you hear me",
  "you hear me",
  "not bad",
  "that makes sense",
  "makes sense",
  "that's great",
  "that's fine",
  "that's good",
  "that's right",
  "thats great",
  "thats right",
] as const;

/** At most this many words for small talk; anything longer is Q's. */
const SMALLTALK_MAX_WORDS = 7;

function words(transcript: string): readonly string[] {
  return transcript
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\s-]+/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 0);
}

/** True when the whole utterance is greeting/acknowledgement/filler. */
export function isSmallTalk(transcript: string): boolean {
  const said = words(transcript);
  if (said.length === 0) return true;
  if (said.length > SMALLTALK_MAX_WORDS) return false;
  let rest = ` ${said.join(" ")} `;
  for (const phrase of TRIVIAL_PHRASES)
    rest = rest.split(` ${phrase} `).join(" ");
  return rest
    .trim()
    .split(" ")
    .filter((w) => w.length > 0)
    .every((w) => TRIVIAL.has(w));
}

/**
 * RECOVERY A3 (C-03/B-01, founder live 2026-10-08): with a card in focus,
 * only a reply about the card is the card's. "Find anything that needs my
 * attention" (6 words) went to the voice model and decide_card because
 * every utterance of twelve words or fewer did. A card reply names what
 * to do with the card; a question or a request for something else is Q's.
 */
const CARD_VERBS = new Set([
  "send",
  "sent",
  "approve",
  "approved",
  "go",
  "yes",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "no",
  "nope",
  "skip",
  "later",
  "dismiss",
  "ignore",
  "drop",
  "cancel",
  "edit",
  "change",
  "rewrite",
  "redo",
  "warmer",
  "shorter",
  "longer",
  "softer",
  "friendlier",
  "formal",
  "casual",
  "book",
  "schedule",
  "reschedule",
  "accept",
  "decline",
  "next",
  "previous",
  "moving",
  "retry",
  "again",
  "snooze",
  "remind",
  "leave",
  "keep",
  "pass",
]);
const CARD_PHRASES = ["not now", "move on", "do it", "that one", "this one"];
/** Opening words of a question or of a request for something else. */
const ELSEWHERE = new Set([
  "what",
  "what's",
  "whats",
  "why",
  "how",
  "who",
  "who's",
  "which",
  "where",
  "find",
  "show",
  "open",
  "tell",
  "explain",
  "read",
  "give",
  "search",
  "look",
  "check",
  "take",
  "anything",
  "is",
  "are",
  "does",
  "do",
]);

/** True when the words are a reply about the decision card in focus. */
export function isCardReply(transcript: string): boolean {
  const said = words(transcript);
  if (said.length === 0 || said.length > 12) return false;
  const first = said[0] ?? "";
  // "do it" is a reply; "do they fit?" is not.
  const joined = ` ${said.join(" ")} `;
  if (ELSEWHERE.has(first) && !joined.startsWith(" do it ")) return false;
  if (CARD_PHRASES.some((phrase) => joined.includes(` ${phrase} `))) {
    return true;
  }
  return said.some((w) => CARD_VERBS.has(w));
}

export function routeDuplexTurn(
  transcript: string,
  situation: {
    /** Q leads this line (welcome, interview): every word is Q's. */
    readonly guided: boolean;
    /** Q's last answer asked for their yes: the reply is Q's to take. */
    readonly awaitingApproval: boolean;
    /** A decision card is in focus: a reply about it goes to decide_card. */
    readonly cardInFocus: boolean;
    /**
     * Q's last words were a question to them ("want the detail?"): a bare
     * "yes" or "no" answers Q, so it is Q's, never the voice's alone.
     */
    readonly answeringQ?: boolean | undefined;
  },
): DuplexTurnRoute {
  if (situation.guided || situation.awaitingApproval) return "ASK_Q";
  // The card's own code reads the reply (the same typed action a button
  // sends); the voice only passes the words through decide_card.
  if (situation.cardInFocus && isCardReply(transcript)) return "MODEL";
  if (situation.answeringQ === true) return "ASK_Q";
  return isSmallTalk(transcript) ? "SMALLTALK" : "ASK_Q";
}
