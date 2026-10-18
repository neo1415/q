/**
 * Lane N (owner, 2026-10-15: "the conversations are AI slop too").
 *
 * Code's own read of a draft against what the person's side already wrote
 * in the conversation, before it is sent or offered. Live evidence
 * (Tensorgate and Zino, 8-15 Oct): the same 60-word message went twice,
 * seven hours apart, and every reply opened "Hello Tensorgate team -- thank
 * you for..." and restated the enclave pitch. A failing draft is planned
 * again with the reason (like any refusal); nothing here sends anything.
 */

/** A reply is a short note: past this it is restating, not answering. */
export const REPLY_WORDS_MAX = 80;
/** A first message or follow-up may carry a little more context. */
export const MESSAGE_WORDS_MAX = 120;
/** Word-trigram overlap at or above this is the same message again. */
export const NEAR_DUPLICATE_AT = 0.5;

export type QualityProblem =
  | "NEAR_DUPLICATE"
  | "MESSAGE_TOO_LONG"
  | "REPEATED_PLEASANTRY"
  | "MORE_THAN_ONE_ASK";

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[^a-z0-9$%'\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word !== "");

function trigrams(text: string): Set<string> {
  const list = words(text);
  const out = new Set<string>();
  for (let index = 0; index + 2 < list.length; index += 1) {
    out.add(
      `${list[index] ?? ""} ${list[index + 1] ?? ""} ${list[index + 2] ?? ""}`,
    );
  }
  return out;
}

/** Jaccard overlap of two texts' word trigrams, 0..1. */
export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  // Under three words there are no trigrams: only the same words match.
  if (left.size === 0 || right.size === 0) {
    return words(a).join(" ") === words(b).join(" ") ? 1 : 0;
  }
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Opening pleasantries: greetings and thanks before the first point. */
const PLEASANTRY =
  /^(?:(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^.!?]{0,60}?[,—–-]\s*)?(?:thank(?:s| you)|many thanks|great to hear|i appreciate|we appreciate|appreciate)/iu;

export function opensWithPleasantry(text: string): boolean {
  return PLEASANTRY.test(text.trim());
}

/** Questions asked: more than one is more than one ask. */
function asks(text: string): number {
  return (text.match(/\?/gu) ?? []).length;
}

/**
 * The first problem with a draft, or null. `ours` is what the person's
 * side already wrote in this conversation, oldest first.
 */
export function qualityProblem(input: {
  readonly body: string;
  readonly replying: boolean;
  readonly ours: readonly string[];
}): QualityProblem | null {
  const count = words(input.body).length;
  if (count > (input.replying ? REPLY_WORDS_MAX : MESSAGE_WORDS_MAX)) {
    return "MESSAGE_TOO_LONG";
  }
  if (
    input.ours.some(
      (previous) => similarity(previous, input.body) >= NEAR_DUPLICATE_AT,
    )
  ) {
    return "NEAR_DUPLICATE";
  }
  const last = input.ours[input.ours.length - 1];
  if (
    input.replying &&
    last !== undefined &&
    opensWithPleasantry(last) &&
    opensWithPleasantry(input.body)
  ) {
    return "REPEATED_PLEASANTRY";
  }
  if (asks(input.body) > 1) return "MORE_THAN_ONE_ASK";
  return null;
}
