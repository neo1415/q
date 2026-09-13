import type { OnboardingResponseValue } from "@capital-q/contracts";
import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";

import type { JourneyVocabulary } from "../onboarding-conversation/conversation";
import { groupOf } from "./models/journey";

/**
 * Investor Definition v1 in the words the Q-led interview uses
 * (CQ-PRE-REC-001 §24, §29). Titles and option labels come from the pinned
 * definition itself. A hard exclusion is a review line like any other; it
 * is only ever written by the person's explicit confirmation.
 */

const S = INVESTOR_STEPS;

const TITLES: Readonly<Record<string, string>> = {
  [S.investorType]: "Investor type",
  [S.organisationName]: "Organisation",
  [S.businessTitle]: "Your title",
  [S.deploymentStatus]: "Deploying capital",
  [S.mandateContext]: "Mandate",
  [S.stages]: "Stages",
  [S.currency]: "Currency",
  [S.chequeMin]: "Smallest cheque",
  [S.chequeTypical]: "Typical cheque",
  [S.chequeMax]: "Largest cheque",
  [S.investmentRole]: "Lead or follow",
  [S.geography]: "Geography",
  [S.geographyStrength]: "How firm on geography",
  [S.sectors]: "Sectors",
  [S.sectorStrength]: "How firm on sectors",
  [S.sectorsAvoid]: "Sectors to show lower",
  [S.businessModels]: "Business models",
  [S.customerTypes]: "Customer types",
  [S.capitalIntensity]: "Capital intensity",
  [S.regulatoryAppetite]: "Regulation",
  [S.revenueState]: "Revenue expectation",
  [S.founderPreferences]: "Founder preferences",
  [S.founderStrength]: "How firm on founders",
  [S.greenFlags]: "Green flags",
  [S.greenFlagStrength]: "How firm on green flags",
  [S.customCriteria]: "Your own criteria",
  [S.avoid]: "Show lower",
  [S.hardExclusions]: "Never show",
  [S.sectorExclusions]: "Sectors never shown",
  [S.portfolio]: "Portfolio",
  [S.discoveryMode]: "Discovery style",
  [S.inboundPreference]: "Inbound",
  [S.additionalContext]: "In your own words",
  [S.review]: "Mandate review",
  [S.handoff]: "Handoff",
};

const STEPS = new Map(
  INVESTOR_DEFINITION_V1.steps.map((step) => [step.stepKey, step]),
);

function optionLabel(stepKey: string, optionKey: string): string {
  const configuration = STEPS.get(stepKey)?.configuration as
    | { readonly options?: readonly { optionKey: string; label: string }[] }
    | undefined;
  return (
    configuration?.options?.find((option) => option.optionKey === optionKey)
      ?.label ?? optionKey.replace(/_/g, " ")
  );
}

function describe(
  stepKey: string,
  value: OnboardingResponseValue,
  labels?: Readonly<Record<string, string>>,
): string {
  switch (value.type) {
    case "SINGLE_SELECT":
      return optionLabel(stepKey, value.optionKey);
    case "MULTI_SELECT":
      return value.optionKeys
        .map((key) => optionLabel(stepKey, key))
        .join(", ");
    case "RANGE":
      return Number.parseFloat(value.value).toLocaleString();
    case "TEXT":
      return value.text;
    case "RESOURCE_REFERENCE": {
      const named = value.resourceIds.map((id) => labels?.[id]);
      if (named.every((label) => label !== undefined)) {
        return named.join(", ");
      }
      return value.resourceIds.length === 1
        ? "1 selected"
        : `${String(value.resourceIds.length)} selected`;
    }
    case "CONFIRMATION":
      return value.confirmed ? "Confirmed" : "Not confirmed";
  }
}

export const INVESTOR_VOCABULARY: JourneyVocabulary = {
  subject: "investor",
  stepTitle: (stepKey) =>
    TITLES[stepKey] ?? STEPS.get(stepKey)?.configuration.prompt ?? stepKey,
  describe,
  editorFor: (stepKey) => groupOf(stepKey)?.id,
  reviewGroups: [
    {
      label: "Mandate",
      stepKeys: [
        S.investorType,
        S.organisationName,
        S.businessTitle,
        S.deploymentStatus,
        S.mandateContext,
      ],
    },
    {
      label: "Cheque",
      stepKeys: [
        S.currency,
        S.chequeMin,
        S.chequeTypical,
        S.chequeMax,
        S.investmentRole,
      ],
    },
    { label: "Stage", stepKeys: [S.stages] },
    { label: "Geography", stepKeys: [S.geography, S.geographyStrength] },
    {
      label: "Sector",
      stepKeys: [S.sectors, S.sectorStrength, S.sectorsAvoid],
    },
    {
      label: "Preferences",
      stepKeys: [
        S.businessModels,
        S.customerTypes,
        S.capitalIntensity,
        S.regulatoryAppetite,
        S.revenueState,
        S.founderPreferences,
        S.founderStrength,
        S.greenFlags,
        S.greenFlagStrength,
        S.customCriteria,
      ],
    },
    { label: "Avoid", stepKeys: [S.avoid] },
    {
      label: "Hard exclusions",
      stepKeys: [S.hardExclusions, S.sectorExclusions],
    },
    {
      label: "Discovery style",
      stepKeys: [S.portfolio, S.discoveryMode, S.inboundPreference],
    },
    { label: "Unknowns", stepKeys: [S.additionalContext] },
  ],
  finalStepKeys: [S.handoff],
};
