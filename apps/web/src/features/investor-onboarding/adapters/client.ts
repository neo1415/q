import type { OnboardingClient } from "../../onboarding-kit/client";
import type {
  InvestorOnboardingSessionView,
  StepResponse,
} from "../models/presentation";

/** The investor journey's client: the kit's generic port bound to its views. */
export type InvestorOnboardingClient = OnboardingClient<
  InvestorOnboardingSessionView,
  StepResponse
>;

export {
  OnboardingClientError,
  type ClientFailureKind,
  type TaxonomyCandidateView,
} from "../../onboarding-kit/client";
