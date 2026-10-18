/**
 * RECOVERY-2026-10 B5 (audit B-05): pure pleasantries -- "hi Q", "thanks",
 * "good morning", "how are you?" -- are answered by code, at once. They
 * paid for the turn reader, the analyst's prefetch reads and a tool-bearing
 * analyst call with ~127 tool definitions, for "Hi! What can I do for
 * you?". Only a whole turn that is nothing but a pleasantry matches;
 * "hi Q, what needs my attention?" is a request and goes the full way.
 *
 * Transport copy owned by code, like the unclear prompts: short, warm,
 * varied by a seed so Q never greets the same way twice running, and never
 * a claim about anything Q did or knows.
 */

export type PleasantryKind = "GREETING" | "HOW_ARE_YOU" | "THANKS" | "GOODBYE";

/** Optional address to Q at either end ("hey Q", "thanks, Q!"). */
const Q_NAME = "(?:q|cue|queue)";
const LEAD = `^(?:(?:oh|ok(?:ay)?|well|so)[,!.\\s]+)?(?:${Q_NAME}[,!.\\s]+)?`;
const TAIL = `(?:[,!.\\s]+${Q_NAME})?(?:[,!.\\s]+(?:there|mate|buddy|friend))?[\\s!.,?:)]*$`;

const PATTERNS: readonly (readonly [PleasantryKind, RegExp])[] = [
  [
    "HOW_ARE_YOU",
    new RegExp(
      `${LEAD}(?:(?:hi|hello|hey)[,!.\\s]+(?:${Q_NAME}[,!.\\s]+)?)?(?:how\\s+are\\s+(?:you|u)(?:\\s+(?:doing|today)){0,2}|how(?:'s|\\s+is)\\s+it\\s+going|how\\s+have\\s+you\\s+been|you\\s+(?:ok|alright|good))${TAIL}`,
      "iu",
    ),
  ],
  [
    "GREETING",
    new RegExp(
      `${LEAD}(?:hi|hello|hey|hiya|yo|howdy|greetings|good\\s+(?:morning|afternoon|evening|day))${TAIL}`,
      "iu",
    ),
  ],
  [
    "THANKS",
    new RegExp(
      `${LEAD}(?:thanks?(?:\\s+(?:so\\s+much|a\\s+lot|very\\s+much))?|thank\\s+you(?:\\s+(?:so\\s+much|very\\s+much))?|cheers|much\\s+appreciated|appreciate\\s+it)${TAIL}`,
      "iu",
    ),
  ],
  [
    "GOODBYE",
    new RegExp(
      `${LEAD}(?:(?:good)?bye|bye\\s+for\\s+now|see\\s+(?:you|ya)(?:\\s+(?:later|soon|tomorrow))?|talk\\s+(?:to\\s+you\\s+)?(?:later|soon)|good\\s*night|that'?s\\s+all(?:\\s+for\\s+now)?)${TAIL}`,
      "iu",
    ),
  ],
];

/** The pleasantry a whole turn is, or null when it asks anything more. */
export function pleasantryOf(text: string): PleasantryKind | null {
  const said = text.trim().replace(/[’]/gu, "'");
  if (said.length === 0 || said.length > 60) return null;
  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(said)) return kind;
  }
  return null;
}

const REPLIES: Readonly<Record<PleasantryKind, readonly string[]>> = {
  GREETING: [
    "Hi! What would you like to work on?",
    "Hello. What can I do for you?",
    "Hey, good to hear from you. What's on your mind?",
    "Hi there. Where shall we start?",
  ],
  HOW_ARE_YOU: [
    "I'm well, thanks for asking. How about you, and what can I help with?",
    "Doing well, thank you. What's on your plate today?",
    "All good here. How are things on your side?",
  ],
  THANKS: ["You're welcome.", "Any time.", "Glad to help.", "My pleasure."],
  GOODBYE: ["Talk soon.", "Bye for now. I'll be here.", "See you later."],
};

/**
 * The reply, chosen by a seed (the run id) so it varies, and never the
 * line Q said last in this conversation.
 */
export function pleasantryReply(
  kind: PleasantryKind,
  seed: string,
  lastSaid: string | null = null,
): string {
  const lines = REPLIES[kind];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const first = lines[hash % lines.length] ?? lines[0] ?? "Hello.";
  if (first !== lastSaid) return first;
  return lines[(hash + 1) % lines.length] ?? first;
}
