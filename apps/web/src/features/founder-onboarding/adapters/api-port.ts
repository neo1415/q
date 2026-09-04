import { CATEGORY_VOCABULARIES } from "@capital-q/founder-onboarding/definition";

import { createApiRuntimePort } from "../../onboarding-kit/api-port";
import type { RuntimePort } from "../../onboarding-kit/runtime-port";

export const API_ADAPTER_NAME = "FounderOnboardingApiClient";

/** The real runtime for the founder journey, through the kit's server actions. */
export function createFounderApiRuntimePort(): RuntimePort {
  return createApiRuntimePort({
    journeyType: "founder",
    candidateVocabularies: CATEGORY_VOCABULARIES,
  });
}
