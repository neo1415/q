import { normaliseCommand } from "../step-commands.js";
import type { StoryEditionId } from "./editions.js";

/**
 * When the story starts from words (plan §4, Triggers):
 *
 * - "present Capital Q", "pitch Capital Q", "tell me your story": the
 *   story track, through the existing Q_PITCH destination;
 * - "What is Capital Q?" alone: a two-sentence answer and an offer to show
 *   it. A one-line question never launches a seven-minute film unasked.
 *
 * Deterministic and narrow: anything else is not a trigger here (Q's own
 * turn reader still decides every other request).
 */
export type StoryTrigger =
  | {
      readonly kind: "STORY";
      /** Which cut: "to an investor" INVESTOR, "to a founder" FOUNDER. */
      readonly edition: StoryEditionId;
    }
  | { readonly kind: "BRIEF"; readonly answer: string; readonly offer: string };

/** Plain words, no figures, nothing beyond the product's documented design. */
export const CAPITAL_Q_BRIEF =
  "Capital Q is an investment intelligence platform for private capital: investors find and understand the businesses that genuinely fit how they invest, and businesses see what investors will see and reach the investors who suit them. I'm Q, the analyst inside it, and I work from evidence before opinion.";
export const CAPITAL_Q_OFFER =
  "Want me to show you? It takes about seven minutes.";

const NAME =
  "(?:capital ?q|capitalq|capital (?:cue|queue|kyu|kew)|this platform|this app)";
/**
 * What may come before the ask, typed or as a speech transcript: "Q" is
 * often written "cue", "queue" or "Kyu" by speech-to-text, and a greeting
 * comes before it ("Hey, cue. Pitch yourself." live, 23 Oct).
 */
const LEAD =
  "(?:(?:q|cue|queue|kyu|kew|hey|hi|hello|ok|okay|so|alright|please|now|can you|could you|would you|will you)\\s+)*";
const STORY = new RegExp(
  `^${LEAD}(?:(?:present|pitch|demo|introduce)\\s+(?:us\\s+|me\\s+)?(?:${NAME}|yourself)|(?:tell|show)\\s+(?:me|us)\\s+(?:your|the)\\s+story|(?:tell|show)\\s+(?:me|us)\\s+the\\s+capital ?q\\s+story|give\\s+(?:me|us)\\s+(?:the|your)\\s+pitch|pitch)(?:\\s+(?:to|for)\\s+(?:an?\\s+|the\\s+)?(investors?|founders?|business(?:es)?|companies|company|everyone|everybody|all))?(?:\\s+(?:please|now|to me|to us))*$`,
  "u",
);
const BARE = new RegExp(`^${LEAD}pitch(?:\\s+(?:please|now))*$`, "u");
const BRIEF = new RegExp(
  `^${LEAD}(?:what\\s+is|what\\s+s|whats)\\s+${NAME}$`,
  "u",
);

function audience(word: string | undefined): StoryEditionId {
  if (word === undefined) return "FULL";
  if (word.startsWith("investor")) return "INVESTOR";
  if (/^(?:founder|business|compan)/u.test(word)) return "FOUNDER";
  return "FULL";
}

export function classifyStoryTrigger(text: string): StoryTrigger | null {
  const said = normaliseCommand(text);
  if (said.length === 0 || said.length > 80) return null;
  const story = STORY.exec(said);
  // "pitch" alone is not an ask; "pitch to an investor" and "give me the
  // pitch" are.
  if (story !== null && !BARE.test(said)) {
    return { kind: "STORY", edition: audience(story[1]) };
  }
  if (BRIEF.test(said)) {
    return { kind: "BRIEF", answer: CAPITAL_Q_BRIEF, offer: CAPITAL_Q_OFFER };
  }
  return null;
}
