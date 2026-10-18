import { FOUNDER_STEPS } from "@capital-q/founder-onboarding";

/**
 * Steps whose answer the platform already holds as canonical data, kept
 * apart from the conductor so the interview loop can settle them without
 * importing the conductor that wraps it.
 */

export type KnownAnswer = {
  readonly stepKey: string;
  /** An option key or text the step's own validation accepts. */
  readonly raw: string;
  readonly because: "JOURNEY_CHOICE";
};

/**
 * Steps whose answer the platform already holds as canonical data.
 *
 * F0.intent ("What brings you to Capital Q?") is answered by the journey
 * the person chose: the founder card reads "I'm raising", which is the
 * step's `raising_now` option ("I'm raising for a company"). Whether a
 * round is actually open is asked later, on F6.raising; this records only
 * the choice they made, never a model's reading of a sentence.
 */
export function answersKnownFromJourney(
  journeyType: "founder" | "investor",
): readonly KnownAnswer[] {
  return journeyType === "founder"
    ? [
        {
          stepKey: FOUNDER_STEPS.intent,
          raw: "raising_now",
          because: "JOURNEY_CHOICE",
        },
      ]
    : [];
}

export type KnownAnswerPort = {
  /** Records a platform-held answer; false when it is already answered. */
  readonly recordKnown: (stepKey: string, raw: string) => Promise<boolean>;
};

/** Records every known answer not yet on the record. Never throws. */
export async function settleKnownAnswers(
  port: KnownAnswerPort,
  journeyType: "founder" | "investor",
): Promise<readonly string[]> {
  const recorded: string[] = [];
  for (const known of answersKnownFromJourney(journeyType)) {
    const ok = await port
      .recordKnown(known.stepKey, known.raw)
      .catch(() => false);
    if (ok) recorded.push(known.stepKey);
  }
  return recorded;
}
