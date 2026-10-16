import type { QTurnAuthority } from "@capital-q/model-gateway/q";
import type { OnboardingStepManifest } from "@capital-q/onboarding";

/**
 * The independent reading of a turn, where code can decide it exactly
 * (owner 2026-10-16: cut delegation readings where code can decide).
 *
 * Only one case is decided here: their whole reply is, word for word, one
 * of the choices of the step Q just asked ("Seed", "series a."), a bare
 * figure for a number step Q just asked ("14"), or a few plain words for a
 * short text step Q just asked ("Partner"). That states that step and
 * nothing else: it hands nothing to Q, approves nothing, declines nothing,
 * finishes nothing, asks no look-up. Anything else, and whenever a
 * recommendation is waiting for their yes, goes to the reader as before:
 * null. Narrower than the reader, never wider.
 */

const MAX_UTTERANCE = 60;

const normal = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .replace(/[.!?,;:]+$/u, "")
    .trim();

/**
 * A short reply that can only be the asked text step's answer: a few words,
 * no question, no figure, and none of the ways people decline, defer,
 * delegate or finish (those are the reader's). "Partner." for a title (live
 * 2026-10-16: the reader missed it and the title was refused twice).
 */
const NOT_AN_ANSWER =
  /\b(skip|no|none|not|n\/a|later|pass|rather|unsure|dunno|don't|do not|you|pick|choose|decide|finish|done|stop|pause|yes|yeah|ok|okay|sure|why|what|how|hi|hello|hey|thanks|thank)\b/u;
function shortTextAnswer(said: string): boolean {
  const words = said.split(" ").filter((w) => w.length > 0);
  return (
    words.length >= 1 &&
    words.length <= 4 &&
    !said.includes("?") &&
    !/\d/.test(said) &&
    !NOT_AN_ANSWER.test(said)
  );
}

/** Whether their words are exactly one of a choice step's options. */
function namesOption(step: OnboardingStepManifest, said: string): boolean {
  const config = step.configuration;
  if (config.stepType !== "single_select") return false;
  return config.options.some((option) => {
    const label = normal(option.label);
    // "US dollars" for "US dollar": a plural is the same choice.
    return (
      label === said ||
      `${label}s` === said ||
      normal(option.optionKey) === said
    );
  });
}

const BARE_FIGURE = /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/;

export function codeReading(input: {
  readonly utterance: string;
  /** The step Q's last turn asked, if code knows it. */
  readonly asked: OnboardingStepManifest | undefined;
  /**
   * The step Q asked the turn before, still open: a bare figure given late
   * answers it (live 2026-10-16: "1200000" said after Q had moved on from
   * "how much are you raising?" to the currency).
   */
  readonly askedBefore?: OnboardingStepManifest | undefined;
  /**
   * Choice steps still open on their path: words that are exactly one of
   * their options, unambiguously, state that step even when Q asked
   * another ("US dollars." under "how much are you raising?").
   */
  readonly openChoices?: readonly OnboardingStepManifest[] | undefined;
  /** Recommendations waiting for their decision: a "yes" could approve one. */
  readonly pendingCount: number;
}): QTurnAuthority | null {
  const { asked } = input;
  const said = normal(input.utterance);
  if (input.pendingCount > 0) return null;
  // A question is never an answer, whatever it names.
  if (input.utterance.includes("?")) return null;
  if (said.length === 0 || said.length > MAX_UTTERANCE) return null;
  const stated = (step: OnboardingStepManifest): QTurnAuthority => ({
    stated: new Set([step.stepKey]),
    declined: new Set(),
    handed: new Set(),
    approved: new Set(),
    finishing: false,
    lookup: null,
    pausing: false,
    pronounce: null,
  });
  if (asked !== undefined) {
    const config = asked.configuration;
    const answersAsked =
      config.stepType === "single_select"
        ? namesOption(asked, said)
        : config.stepType === "range"
          ? BARE_FIGURE.test(said)
          : config.stepType === "short_text"
            ? shortTextAnswer(said)
            : false;
    if (answersAsked) return stated(asked);
  }
  // Exactly one open choice step has these words as an option.
  const named = (input.openChoices ?? []).filter((step) =>
    namesOption(step, said),
  );
  if (named.length === 1 && named[0] !== undefined) return stated(named[0]);
  // A bare figure for the number question asked just before.
  const before = input.askedBefore;
  if (
    before !== undefined &&
    before.configuration.stepType === "range" &&
    asked?.configuration.stepType !== "range" &&
    BARE_FIGURE.test(said)
  ) {
    return stated(before);
  }
  return null;
}
