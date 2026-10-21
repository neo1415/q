import { normaliseCommand } from "../step-commands.js";

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
  | { readonly kind: "STORY" }
  | { readonly kind: "BRIEF"; readonly answer: string; readonly offer: string };

/** Plain words, no figures, nothing beyond the product's documented design. */
export const CAPITAL_Q_BRIEF =
  "Capital Q is an investment intelligence platform for private capital: investors find and understand the businesses that genuinely fit how they invest, and businesses see what investors will see and reach the investors who suit them. I'm Q, the analyst inside it, and I work from evidence before opinion.";
export const CAPITAL_Q_OFFER =
  "Want me to show you? It takes about seven minutes.";

const NAME = "(?:capital ?q|capitalq|capital cue|this platform|this app)";
const STORY = new RegExp(
  `^(?:(?:q|hey q|ok|okay|please|can you|could you|would you)\\s+)*(?:(?:present|pitch|demo|introduce)\\s+(?:us\\s+|me\\s+)?${NAME}|(?:tell|show)\\s+(?:me|us)\\s+(?:your|the)\\s+story|(?:tell|show)\\s+(?:me|us)\\s+the\\s+capital ?q\\s+story|give\\s+(?:me|us)\\s+(?:the|your)\\s+pitch)(?:\\s+(?:please|now|to me|to us))*$`,
  "u",
);
const BRIEF = new RegExp(
  `^(?:(?:q|hey q|ok|so)\\s+)*(?:what\\s+is|what\\s+s|whats)\\s+${NAME}$`,
  "u",
);

export function classifyStoryTrigger(text: string): StoryTrigger | null {
  const said = normaliseCommand(text);
  if (said.length === 0 || said.length > 80) return null;
  if (STORY.test(said)) return { kind: "STORY" };
  if (BRIEF.test(said)) {
    return { kind: "BRIEF", answer: CAPITAL_Q_BRIEF, offer: CAPITAL_Q_OFFER };
  }
  return null;
}
