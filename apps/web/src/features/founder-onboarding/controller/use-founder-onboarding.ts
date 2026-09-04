"use client";

import {
  useOnboardingJourney,
  type OnboardingActions,
  type OnboardingState,
} from "../../onboarding-kit/controller";
import type { FounderOnboardingClient } from "../adapters/client";
import type {
  FounderOnboardingSessionView,
  StepResponse,
} from "../models/presentation";

export type {
  OnboardingPhase,
  SaveStatus,
} from "../../onboarding-kit/controller";

export type FounderOnboardingState =
  OnboardingState<FounderOnboardingSessionView>;
export type FounderOnboardingActions = OnboardingActions<StepResponse>;

/** The kit controller bound to the founder journey. */
export function useFounderOnboarding(
  client: FounderOnboardingClient | null,
): [FounderOnboardingState, FounderOnboardingActions] {
  return useOnboardingJourney<FounderOnboardingSessionView, StepResponse>(
    client,
  );
}
