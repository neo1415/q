import {
  GEOGRAPHY_VOCABULARIES,
  SECTOR_VOCABULARIES,
} from "@capital-q/investor-onboarding/definition";

import { createApiRuntimePort } from "../../onboarding-kit/api-port";
import type { RuntimePort } from "../../onboarding-kit/runtime-port";

export const API_ADAPTER_NAME = "InvestorOnboardingApiClient";

/** The real runtime for the investor journey, through the kit's server actions. */
export function createInvestorApiRuntimePort(): RuntimePort {
  return createApiRuntimePort({
    journeyType: "investor",
    candidateVocabularies: [...GEOGRAPHY_VOCABULARIES, ...SECTOR_VOCABULARIES],
  });
}
