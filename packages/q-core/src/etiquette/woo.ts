/**
 * Messages that woo (founder, 2026-10-07: "some of the messages I'm seeing
 * are just so direct... they don't know how to woo an investor").
 *
 * Two halves. WOO_GUIDANCE is the fixed wording guidance the writing
 * prompts carry (both sides: an investor's Q writing to a founder, and a
 * founder's Q writing to an investor). wooProblem is code's own check of a
 * draft Q wrote, before it is sent or offered: a draft that fails it is
 * sent back to be written again once, never sent as it is.
 *
 * The check reads only Q's OWN draft, never the other side's words. A false
 * hit costs a rewrite; it never sends, decides or blocks anything else.
 */

/** Hard ceiling: past this a chat message is no longer a note. */
export const WOO_WORDS_MAX = 160;
/** What the prompts ask for: long enough to be specific, short enough to read. */
export const WOO_WORDS_TARGET = { min: 60, max: 120 } as const;

export const WOO_PROBLEMS = [
  /** The first thing it does is ask, tell or demand. */
  "OPENS_WITH_DEMAND",
  /** Nothing in it is about the recipient in particular. */
  "NOTHING_SPECIFIC",
  /** Longer than a short note. */
  "WOO_TOO_LONG",
  /** Pressure: "you must", "act now", "don't miss". */
  "PUSHY",
  /** They wrote first, and it introduces the sender as if they hadn't. */
  "COLD_OPEN_IN_REPLY",
] as const;
export type WooProblem = (typeof WOO_PROBLEMS)[number];

/** What to change, in the writer's terms, for the one rewrite. */
export const WOO_FEEDBACK: Readonly<Record<WooProblem, string>> = {
  OPENS_WITH_DEMAND:
    "Do not open with a request or an instruction. Open with something genuine and specific about them, then make one soft ask at the end.",
  NOTHING_SPECIFIC:
    "Say something specific about them -- their thesis, portfolio, company or what they said -- taken from the material.",
  WOO_TOO_LONG: `Keep it to a short note: ${String(WOO_WORDS_TARGET.min)}-${String(WOO_WORDS_TARGET.max)} words.`,
  PUSHY:
    "Remove the pressure: no 'you must', 'act now', 'don't miss', deadlines or urgency. One gracious, low-friction ask.",
  COLD_OPEN_IN_REPLY:
    "They wrote to you first: reply to what they said; do not introduce yourself as if they had not.",
};

/**
 * How a cold introduction opens: discovery of them, or presenting oneself.
 * In a reply it ignores that they wrote first (live seed, Ledgerline 7 Oct).
 */
export const COLD_OPEN =
  /\b(?:came across|come across|found (?:you|your|the company)|discovered (?:you|your|the company)|(?:i|we)(?:'|’)?d (?:like|love) to introduce|(?:let|allow) me to introduce)\b/iu;

/** Pressure and hard-sell phrasing; never in a message Q writes. */
const PUSHY =
  /\b(?:you (?:must|need to|have to|should really)|act (?:now|fast|quickly)|don(?:'|’)?t miss|do not miss|won(?:'|’)?t want to miss|last chance|limited (?:time|spots|window|allocation)|before it(?:'|’)?s too late|hurry|urgent(?:ly)?|asap|right away|immediately|once[- ]in[- ]a[- ]lifetime|closing (?:soon|fast|this week)|final (?:call|opportunity)|(?:spots|allocation) (?:are|is) (?:filling|going) fast|fomo|guaranteed returns?)\b/iu;

/** A greeting or address that may come before the first real sentence. */
const GREETING =
  /^(?:(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^,.!?\n—–-]{0,60}[,.!—–-]?\s*)/iu;

/**
 * What a demanding opening starts with: an instruction, a request for
 * something, or a statement of need. Read on the first sentence after any
 * greeting.
 */
const DEMAND_OPENING =
  /^(?:please\s+)?(?:send|share|give|provide|forward|tell|reply|respond|confirm|book|schedule|sign|transfer|wire|call|email|get back|let me know|make sure|review|check out|look at|take a look|consider|want (?:the|our|a|to)|need (?:the|your|you)|i need|we need|i want|we want|i expect|we expect|i require|we require|you (?:must|need|should|have to)|can you|could you|would you|will you|are you (?:free|available)|when can|what time)\b/iu;

function firstSentence(body: string): string {
  const withoutGreeting = body.replace(GREETING, "").trimStart();
  const match = /^[^.!?\n]*[.!?]?/u.exec(withoutGreeting);
  return (match?.[0] ?? withoutGreeting).trim();
}

const normal = (text: string) =>
  text.toLowerCase().replace(/[‘’]/gu, "'").replace(/\s+/gu, " ").trim();

export type WooInput = {
  readonly body: string;
  /** The other side wrote last: this is a reply to them. */
  readonly replying: boolean;
  /**
   * Words or short phrases that are specific to the recipient (from their
   * material, their thesis, their portfolio). Empty: code has nothing to
   * check specificity against, and does not guess.
   */
  readonly recipientTerms: readonly string[];
};

/** The first problem with a draft, or null when it may go on. */
export function wooProblem(input: WooInput): WooProblem | null {
  const body = input.body.replace(/\s+/gu, " ").trim();
  const words = body === "" ? 0 : body.split(" ").length;
  if (words > WOO_WORDS_MAX) return "WOO_TOO_LONG";
  if (PUSHY.test(body)) return "PUSHY";
  if (input.replying && COLD_OPEN.test(body)) return "COLD_OPEN_IN_REPLY";
  if (DEMAND_OPENING.test(firstSentence(body))) return "OPENS_WITH_DEMAND";
  const terms = input.recipientTerms
    .map(normal)
    .filter((term) => term.length >= 3);
  if (terms.length > 0) {
    const text = normal(body);
    if (!terms.some((term) => text.includes(term))) return "NOTHING_SPECIFIC";
  }
  return null;
}

/**
 * The wording guidance every writing prompt carries, in fixed words. It
 * shapes wording only: it never adds a fact, an action, a topic or a
 * person, and never changes what the person allowed.
 */
export const WOO_GUIDANCE = `HOW TO WRITE (relationship first; warm, specific, never a hard sell)
- Open with something genuine and specific about them -- their thesis, their portfolio, their company, or what they last said -- taken from the material. Never open with a request, an instruction or yourself.
- Connect it to evidence: one concrete point from the material that shows why this conversation is worth their time. Never invent a fact, a number, a name or shared history.
- End with one clear, soft ask that is easy to say yes to ("would it be useful if...", "happy to...", "if helpful, ..."). One ask only; never a demand, a deadline or pressure ("you must", "act now", "don't miss").
- Respect their time: ${String(WOO_WORDS_TARGET.min)}-${String(WOO_WORDS_TARGET.max)} words, plain sentences, no lists, no generic flattery ("impressive", "amazing", "great company") unless a specific reason follows at once.
- A founder writing to an investor: lead with why this investor specifically (their stated thesis, a portfolio company or a focus the material names), then one crisp traction proof point from the founder's own evidence, then a gracious, low-friction ask (to share the deck, a short note, or a time if they would like one). Write in the company's voice ("we").
- An investor writing to a founder: lead with what specifically drew them to the company, say plainly why it fits what they look for, and invite the founder's view with one easy question or offer.
- In a reply, answer what they said first; never introduce yourself as if they had not written.`;
