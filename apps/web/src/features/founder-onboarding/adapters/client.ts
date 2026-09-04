import type { OnboardingClient } from "../../onboarding-kit/client";
import type {
  FounderOnboardingSessionView,
  StepResponse,
} from "../models/presentation";

/**
 * The founder journey's client: the kit's generic port bound to the founder
 * presentation view and composite responses.
 */
export type FounderOnboardingClient = OnboardingClient<
  FounderOnboardingSessionView,
  StepResponse
>;

export {
  CLIENT_FAILURE_KINDS,
  OnboardingClientError as FounderOnboardingClientError,
  type ClientFailureKind,
  type TaxonomyCandidateView,
} from "../../onboarding-kit/client";
