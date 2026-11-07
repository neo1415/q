import type { OnboardingResponseValue } from "@capital-q/contracts";
import type {
  OnboardingDefinitionManifest,
  OnboardingStepManifest,
} from "@capital-q/onboarding";
import {
  countryOfName,
  countryOfNodeId,
  type IsoCountry,
} from "@capital-q/taxonomy/countries";

import {
  GEOGRAPHY_VOCABULARIES,
  INVESTOR_PHASES,
  INVESTOR_STEPS,
} from "./investor-v1.js";
import {
  INVESTOR_REVISABLE_STEPS as INVESTOR_REVISABLE_STEPS_V2,
  INVESTOR_WEBSITE_STEP,
} from "./investor-v2.js";
import { INVESTOR_DEFINITION_V3 } from "./investor-v3.js";

/**
 * Investor Definition v4 -- v3 with the owner's mandatory set and the
 * firm's headquarters country (DECISIONS 79, 2026-11-07; proposal in
 * docs/ai-handoff/ONBOARDING-TEST-PLAN.md §8).
 *
 * Mandatory = what the profile and the mandate show, plus what matching and
 * verification need. "I don't know" is an answer to every one of them and
 * is recorded as unknown (D-OWN-1; `isNotKnownAnswer`).
 *
 * - New, mandatory: I0.hq_country, after the website. KYB jurisdiction and
 *   founder-side ranking read the firm's country, and no step asked it
 *   (§8, gap 6). One geography node that is a country, like the founder's
 *   F1.country (v8); it writes the organisation's hq_country only.
 * - Now mandatory: the website ("no website yet" is unknown), their role at
 *   the firm, every cheque figure (smallest, typical, largest), how they
 *   take part, where they invest and their sectors.
 * - Now optional: the discovery style (no ranking, eligibility or candidate
 *   code reads it; §8 conflict 4, owner: optional).
 *
 * Every other v3 step, key, branch and write target is the same, so an
 * answer valid in v3 is valid in v4. v3 stays published and immutable.
 */
export const INVESTOR_DEFINITION_V4_VERSION = 4 as const;

export const INVESTOR_HQ_COUNTRY_STEP = "I0.hq_country" as const;

export const INVESTOR_HQ_COUNTRY_WRITE_TARGET = "investor.hq_country" as const;

/** Steps v4 makes mandatory (the new HQ country step is mandatory too). */
export const INVESTOR_V4_NOW_REQUIRED: ReadonlySet<string> = new Set([
  INVESTOR_WEBSITE_STEP,
  INVESTOR_STEPS.businessTitle,
  INVESTOR_STEPS.chequeMin,
  INVESTOR_STEPS.chequeTypical,
  INVESTOR_STEPS.chequeMax,
  INVESTOR_STEPS.investmentRole,
  INVESTOR_STEPS.geography,
  INVESTOR_STEPS.sectors,
]);

/** Steps v4 makes optional. */
export const INVESTOR_V4_NOW_OPTIONAL: ReadonlySet<string> = new Set([
  INVESTOR_STEPS.discoveryMode,
]);

/** Copy that called a now-mandatory step optional. */
const SUPPORTING_TEXT: Readonly<Record<string, string>> = {
  [INVESTOR_WEBSITE_STEP]:
    "Founders can see who you are before they reply. No website yet? Say so; that's an answer.",
  [INVESTOR_STEPS.businessTitle]:
    "A title is descriptive only; it grants no permissions.",
  [INVESTOR_STEPS.geography]: "Regions or countries, or anywhere.",
};

const HQ_COUNTRY_STEP: Omit<OnboardingStepManifest, "sequenceOrder"> = {
  stepKey: INVESTOR_HQ_COUNTRY_STEP,
  required: true,
  branching: null,
  configuration: {
    stepType: "reference_select",
    phaseKey: INVESTOR_PHASES.I0,
    prompt: "Where is your firm based?",
    supportingText: "The country of its headquarters.",
    resourceType: "TAXONOMY_NODE",
    vocabularyCodes: [...GEOGRAPHY_VOCABULARIES],
    minItems: 1,
    maxItems: 1,
  },
  writesTo: [{ targetKey: INVESTOR_HQ_COUNTRY_WRITE_TARGET }],
};

function withMandatorySet(
  step: OnboardingStepManifest,
): OnboardingStepManifest {
  const required = INVESTOR_V4_NOW_REQUIRED.has(step.stepKey)
    ? true
    : INVESTOR_V4_NOW_OPTIONAL.has(step.stepKey)
      ? false
      : step.required;
  const supportingText = SUPPORTING_TEXT[step.stepKey];
  return {
    ...step,
    required,
    configuration:
      supportingText === undefined
        ? step.configuration
        : { ...step.configuration, supportingText },
  };
}

function v4Steps(
  steps: readonly OnboardingStepManifest[],
): OnboardingStepManifest[] {
  const out: Omit<OnboardingStepManifest, "sequenceOrder">[] = [];
  for (const step of steps) {
    out.push(withMandatorySet(step));
    if (step.stepKey === INVESTOR_WEBSITE_STEP) out.push(HQ_COUNTRY_STEP);
  }
  return out.map((step, sequenceOrder) => ({ ...step, sequenceOrder }));
}

export const INVESTOR_DEFINITION_V4: OnboardingDefinitionManifest = {
  ...INVESTOR_DEFINITION_V3,
  version: INVESTOR_DEFINITION_V4_VERSION,
  steps: v4Steps(INVESTOR_DEFINITION_V3.steps),
};

/**
 * The country an I0.hq_country answer names, read against the one canonical
 * country list: one geography node that carries an ISO code (a region is
 * none), or their own words when they are exactly a country's name. "I
 * don't know" names none: unknown stays unknown.
 */
export function investorHqCountryOf(
  value: OnboardingResponseValue | null | undefined,
): IsoCountry | null {
  if (value === null || value === undefined) return null;
  if (value.type === "RESOURCE_REFERENCE") {
    return value.resourceType === "TAXONOMY_NODE" &&
      value.resourceIds.length === 1
      ? countryOfNodeId(value.resourceIds[0])
      : null;
  }
  return value.type === "TEXT" ? countryOfName(value.text) : null;
}

/** The headquarters country may be revised after onboarding too. */
export const INVESTOR_REVISABLE_STEPS: ReadonlySet<string> = new Set([
  ...INVESTOR_REVISABLE_STEPS_V2,
  INVESTOR_HQ_COUNTRY_STEP,
]);
