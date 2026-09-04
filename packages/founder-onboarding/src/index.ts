/**
 * @capital-q/founder-onboarding
 *
 * Owns: the Founder Definition v1 (F0–F8) and the integration layer that
 * maps its semantic write targets and review/snapshot contexts onto the
 * canonical domains through their public services.
 *
 * Does not own: journey state (the onboarding runtime), company, team,
 * taxonomy or capital truth (their own contexts), evidence, Q or any model
 * call. Zero LLM, zero provider SDK.
 */

import type { OnboardingServiceOptions } from "@capital-q/onboarding";

import type { FounderDomainDependencies } from "./integration/services.js";
import { createFounderStepContextProviders } from "./integration/step-contexts.js";
import { createFounderWriteTargets } from "./integration/write-targets.js";

export * from "./definition/index.js";
export {
  onboardingDefinitionIds,
  renderOnboardingDefinitionMigration,
} from "./definition/render-sql.js";
export {
  createFounderDomainServices,
  createFounderReadServices,
  type FounderDomainDependencies,
  type FounderDomainServices,
} from "./integration/services.js";
export {
  boundCompany,
  capitalObjectiveInput,
  createFounderWriteTargets,
  normaliseWebsite,
  resolveFounderContext,
  teamFactsInput,
  type FounderWriteTargetOptions,
} from "./integration/write-targets.js";
export {
  createFounderStepContextProviders,
  type FounderStepContextOptions,
} from "./integration/step-contexts.js";
export {
  responseValues,
  type ResponseValues,
} from "./integration/responses.js";

export type FounderOnboardingIntegrationOptions = FounderDomainDependencies;

/**
 * Everything the composition root registers with `createOnboardingService`
 * for the founder journey: the write-target handlers and the step-context
 * providers. The runtime stays journey-agnostic; this is the only place
 * that knows which target key means which canonical write.
 */
export function createFounderOnboardingIntegration(
  options: FounderOnboardingIntegrationOptions,
): Pick<OnboardingServiceOptions, "writeTargets" | "stepContextProviders"> {
  return {
    writeTargets: createFounderWriteTargets(options),
    stepContextProviders: createFounderStepContextProviders(options),
  };
}

export const PACKAGE_NAME = "@capital-q/founder-onboarding" as const;
