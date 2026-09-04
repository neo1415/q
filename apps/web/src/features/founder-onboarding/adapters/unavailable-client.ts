import { createUnavailableClient } from "../../onboarding-kit/client";
import type { FounderOnboardingClient } from "./client";

/** Every call fails with UNAVAILABLE; never degrades into fixture data. */
export function createUnavailableFounderOnboardingClient(): FounderOnboardingClient {
  return createUnavailableClient(
    "Founder setup isn't available on this build yet.",
  );
}
