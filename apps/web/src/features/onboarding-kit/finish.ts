import type { OnboardingResponseValue } from "@capital-q/contracts";

/**
 * Finishing from the conversation (QA F-138, 26 Oct): the last step's
 * confirmation ("Shall I take you to Discover?") was saved against the
 * session's cursor, which the conversation had left on an earlier step,
 * so it never landed and completion was refused as incomplete. It is
 * saved by its own step key, and the journey completes only once it has.
 */
export async function finishJourney(
  actions: {
    readonly submitValue: (input: {
      readonly stepKey: string;
      readonly value: OnboardingResponseValue;
    }) => Promise<boolean>;
    readonly complete: () => Promise<boolean>;
  },
  finalStepKey: string,
): Promise<boolean> {
  const confirmed = await actions.submitValue({
    stepKey: finalStepKey,
    value: { type: "CONFIRMATION", confirmed: true },
  });
  if (!confirmed) return false;
  return actions.complete();
}
