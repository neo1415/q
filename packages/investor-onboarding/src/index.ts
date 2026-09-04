/**
 * @capital-q/investor-onboarding
 *
 * Owns: the Investor Definition v1 (I0–I12) and the integration layer that
 * maps its semantic write targets and review/handoff contexts onto the
 * canonical Organisation, Investor Organisation, Representative, Mandate,
 * Taxonomy and portfolio-reference domains through their public services.
 *
 * Does not own: journey state (the onboarding runtime), investor or
 * mandate truth (the Investor domain), taxonomy, recommendation, GateQ or
 * any model call. Zero LLM, zero ranking, zero GateQ evaluation.
 */

import type { OnboardingServiceOptions } from "@capital-q/onboarding";

import type { InvestorDomainDependencies } from "./integration/services.js";
import { createInvestorStepContextProviders } from "./integration/step-contexts.js";
import { createInvestorWriteTargets } from "./integration/write-targets.js";

export * from "./definition/index.js";
export {
  createInvestorDomainServices,
  createInvestorReadServices,
  type InvestorDomainDependencies,
  type InvestorDomainServices,
} from "./integration/services.js";
export {
  boundInvestor,
  businessAttributeConstraints,
  createInvestorWriteTargets,
  exclusionConstraints,
  founderPreferenceConstraints,
  greenFlagConstraints,
  organisationTypeFor,
  portfolioNames,
  resolveInvestorContext,
  selectedMandateId,
  stageChequePatch,
  taxonomyPreferencesFromResponses,
  type InvestorWriteTargetOptions,
} from "./integration/write-targets.js";
export {
  createInvestorStepContextProviders,
  type InvestorStepContextOptions,
} from "./integration/step-contexts.js";

export type InvestorOnboardingIntegrationOptions = InvestorDomainDependencies;

/**
 * Everything the composition root registers with `createOnboardingService`
 * for the investor journey: write-target handlers and step-context
 * providers. The runtime stays journey-agnostic.
 */
export function createInvestorOnboardingIntegration(
  options: InvestorOnboardingIntegrationOptions,
): Pick<OnboardingServiceOptions, "writeTargets" | "stepContextProviders"> {
  return {
    writeTargets: createInvestorWriteTargets(options),
    stepContextProviders: createInvestorStepContextProviders(options),
  };
}

export const PACKAGE_NAME = "@capital-q/investor-onboarding" as const;
