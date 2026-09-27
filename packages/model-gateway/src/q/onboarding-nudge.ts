import type { ActorContext } from "@capital-q/security";

/**
 * Q's setup reminder in conversation (founder directive 2026-09-27).
 *
 * Whether a reminder is due is decided by code (the versioned policy in
 * @capital-q/onboarding, over the person's own setup and what was already
 * said to them); whether this turn is a natural pause is decided by code
 * too (no question series in hand, the turn was read). The model is only
 * told, as trusted text, that it MAY add one closing sentence, and how.
 *
 * The port is the person's own: the composition keys it by the actor's
 * user id, and the answer asks only when the plan holds the actor-wide
 * OWN_ONBOARDING scope, which the Context Firewall grants to nobody but
 * the person themselves.
 */
export type QOnboardingNudge = {
  readonly journeyType: "founder" | "investor";
  readonly doneCount: number;
  readonly requiredCount: number;
  readonly minutesLeft: number;
  /** The journey's own names for what is left (definition data). */
  readonly remainingTopics: readonly string[];
};

export type QOnboardingNudgePort = {
  /** The reminder due in this conversation now, if any. Changes nothing. */
  readonly peek: (
    actor: ActorContext,
    conversationId: string,
  ) => Promise<QOnboardingNudge | null>;
  /** The answer that carried it was given: count it. */
  readonly markShown: (
    actor: ActorContext,
    conversationId: string,
  ) => Promise<void>;
};

const TOPIC_MAX = 60;

const clean = (text: string): string =>
  text
    .replace(/["\s]+/g, " ")
    .trim()
    .slice(0, TOPIC_MAX);

/** The trusted note; short, because the environment notes are bounded. */
export function onboardingNudgeNote(nudge: QOnboardingNudge): string {
  const setup =
    nudge.journeyType === "investor" ? "investor setup" : "company setup";
  const minutes =
    nudge.minutesLeft === 1
      ? "about a minute"
      : `about ${String(nudge.minutesLeft)} minutes`;
  const topics = nudge.remainingTopics
    .map(clean)
    .filter((topic) => topic.length > 0)
    .map((topic) => `"${topic}"`)
    .join(", ");
  return [
    `THEIR ${setup.toUpperCase()} IS UNFINISHED: ${String(nudge.doneCount)} of ${String(nudge.requiredCount)} required steps done, ${minutes} left${topics.length > 0 ? `; still open: ${topics}` : ""}.`,
    "Answer what they asked first and in full; never lead with this and never let it hold up their request.",
    "Only if your answer is complete and does not end with a question to them, you MAY close with ONE short, warm sentence offering to pick the setup back up (they can say later, or stop reminding me). Otherwise leave it out. Never repeat it or press.",
  ].join(" ");
}
