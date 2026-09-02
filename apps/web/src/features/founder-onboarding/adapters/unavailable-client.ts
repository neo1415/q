import {
  type FounderOnboardingClient,
  FounderOnboardingClientError,
} from "./client";

/**
 * The client composed when no onboarding backend is configured. Every call
 * fails with UNAVAILABLE, and the screen shows an honest "not available yet"
 * state. This is what production gets until CQ-ONB-002 exists; it never
 * degrades into fixture data.
 */
export function createUnavailableFounderOnboardingClient(): FounderOnboardingClient {
  const unavailable = () =>
    Promise.reject(
      new FounderOnboardingClientError(
        "UNAVAILABLE",
        "Founder setup isn't available on this build yet.",
      ),
    );
  return {
    getSession: unavailable,
    saveResponse: unavailable,
    goBack: unavailable,
    skipStep: unavailable,
    openStep: unavailable,
    attachFile: unavailable,
    removeFile: unavailable,
    retryFile: unavailable,
  };
}
