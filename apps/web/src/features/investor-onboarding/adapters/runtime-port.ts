import {
  createRuntimeClient,
  type JourneyModel,
  type RuntimePort,
} from "../../onboarding-kit/runtime-port";
import {
  currentGroup,
  enrich,
  GROUPS,
  groupById,
  isSupportedVersion,
  planSubmissions,
  toPresentation,
  type PresentationExtras,
} from "../models/journey";
import type {
  InvestorOnboardingSessionView,
  StepResponse,
} from "../models/presentation";
import type { InvestorOnboardingClient } from "./client";

export type { RuntimePort } from "../../onboarding-kit/runtime-port";

/** The investor journey as the kit's runtime client sees it. */
export const INVESTOR_JOURNEY_MODEL: JourneyModel<
  InvestorOnboardingSessionView,
  StepResponse,
  PresentationExtras
> = {
  groups: GROUPS,
  groupById,
  currentGroup,
  isSupportedVersion,
  planSubmissions,
  toPresentation,
  enrich,
};

export function createRuntimeInvestorClient(
  port: RuntimePort,
  source: { readonly adapter: string; readonly synthetic: boolean },
): InvestorOnboardingClient {
  return createRuntimeClient(port, INVESTOR_JOURNEY_MODEL, source);
}
