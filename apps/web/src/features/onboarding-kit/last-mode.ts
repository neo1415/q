/**
 * The mode a person last used for their setup: the form, the typed
 * conversation with Q, or Q's voice (owner 2026-10-16: "one tap resumes
 * exactly where they left off, in the mode they last used").
 *
 * A per-browser convenience in localStorage, read once when the setup
 * opens. Where they left off is the server's (the session's current step
 * and saved answers); this only picks the surface. Storage that is blocked
 * or empty means the default (the conversation), never an error. The
 * founder key is the one the founder screen has always used, so a choice
 * made before this keeps working.
 */
export type OnboardingMode = "form" | "conversation" | "voice";
export type OnboardingJourneyName = "founder" | "investor";

export function lastModeKey(journey: OnboardingJourneyName): string {
  return `cq.onboarding.${journey}.mode`;
}

export function readLastMode(
  journey: OnboardingJourneyName,
): OnboardingMode | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(lastModeKey(journey));
    return value === "form" || value === "conversation" || value === "voice"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function writeLastMode(
  journey: OnboardingJourneyName,
  mode: OnboardingMode,
): void {
  try {
    window.localStorage.setItem(lastModeKey(journey), mode);
  } catch {
    // Nothing to remember it in; the setup still opens, in the default mode.
  }
}

/**
 * How a setup screen opens. Asked to talk (`?talk=1`): Q's voice. Resuming
 * (`?from=home`, the reminder's one tap): the mode they last used, voice
 * included. Otherwise the form if they last chose it, else the conversation.
 */
export function openingMode(input: {
  readonly journey: OnboardingJourneyName;
  readonly startTalking: boolean;
  readonly resuming: boolean;
}): { readonly mode: "form" | "conversation"; readonly talk: boolean } {
  if (input.startTalking) return { mode: "conversation", talk: true };
  const last = readLastMode(input.journey);
  if (last === "form") return { mode: "form", talk: false };
  return { mode: "conversation", talk: input.resuming && last === "voice" };
}
