import type { QTurnAuthority } from "@capital-q/model-gateway/q";
import type { OnboardingStepManifest } from "@capital-q/onboarding";

/**
 * The independent reading of a turn, where code can decide it exactly
 * (owner 2026-10-16: cut delegation readings where code can decide).
 *
 * Only one case is decided here: their whole reply is, word for word, one
 * of the choices of the step Q just asked ("Seed", "series a."), or a bare
 * figure for a number step Q just asked ("14"). That states that step and
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

export function codeReading(input: {
  readonly utterance: string;
  /** The step Q's last turn asked, if code knows it. */
  readonly asked: OnboardingStepManifest | undefined;
  /** Recommendations waiting for their decision: a "yes" could approve one. */
  readonly pendingCount: number;
}): QTurnAuthority | null {
  const { asked } = input;
  const said = normal(input.utterance);
  if (asked === undefined || input.pendingCount > 0) return null;
  if (said.length === 0 || said.length > MAX_UTTERANCE) return null;
  const config = asked.configuration;
  const states =
    config.stepType === "single_select"
      ? config.options.some(
          (option) =>
            normal(option.label) === said || normal(option.optionKey) === said,
        )
      : config.stepType === "range"
        ? /^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(said)
        : false;
  if (!states) return null;
  return {
    stated: new Set([asked.stepKey]),
    declined: new Set(),
    handed: new Set(),
    approved: new Set(),
    finishing: false,
    lookup: null,
    pausing: false,
    pronounce: null,
  };
}
