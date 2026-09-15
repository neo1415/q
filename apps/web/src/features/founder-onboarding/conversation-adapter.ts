import type { OnboardingResponseValue } from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_V2,
  FOUNDER_STEPS,
} from "@capital-q/founder-onboarding";

import type { JourneyVocabulary } from "../onboarding-conversation/conversation";
import { groupOf } from "./models/journey";

/**
 * Founder Definition v2 in the words the Q-led interview uses
 * (CQ-PRE-REC-001 §29). Titles and option labels come from the pinned
 * definition itself, so a review line and a chip never drift from what the
 * runtime validates. No raw field names reach the screen.
 */

const S = FOUNDER_STEPS;

const TITLES: Readonly<Record<string, string>> = {
  [S.intent]: "Why you're here",
  [S.companyName]: "Company",
  [S.website]: "Website",
  [S.country]: "Based in",
  [S.stage]: "Stage",
  [S.description]: "What it does",
  [S.categories]: "Categories",
  [S.materials]: "Documents",
  [S.review]: "Company review",
  [S.founderRole]: "Your role",
  [S.founderCount]: "Founders",
  [S.fullTime]: "Full-time",
  [S.teamSize]: "Team size",
  [S.functions]: "Team strengths",
  [S.signal]: "Traction signal",
  [S.pilots]: "Pilots",
  [S.revenueStatus]: "Revenue",
  [S.customers]: "Paying customers",
  [S.growth]: "Growth",
  [S.raising]: "Raising",
  [S.currency]: "Currency",
  [S.targetAmount]: "Target amount",
  [S.instrument]: "Instrument",
  [S.timeframe]: "Timeframe",
  [S.useOfFunds]: "Use of funds",
  [S.raiseConfirm]: "Raise confirmed",
  [S.followUp]: "Anything else",
  [S.snapshot]: "Snapshot",
};

const STEPS = new Map(
  FOUNDER_DEFINITION_V2.steps.map((step) => [step.stepKey, step]),
);

type OptionsConfiguration = {
  readonly options?: readonly { optionKey: string; label: string }[];
};

function optionsFor(
  stepKey: string,
): readonly { readonly optionKey: string; readonly label: string }[] {
  const configuration = STEPS.get(stepKey)?.configuration as
    OptionsConfiguration | undefined;
  return configuration?.options ?? [];
}

function optionLabel(stepKey: string, optionKey: string): string {
  return (
    optionsFor(stepKey).find((option) => option.optionKey === optionKey)
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
      return stepKey === S.targetAmount
        ? Number.parseFloat(value.value).toLocaleString()
        : value.value;
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

export const FOUNDER_VOCABULARY: JourneyVocabulary = {
  subject: "founder",
  stepTitle: (stepKey) =>
    TITLES[stepKey] ?? STEPS.get(stepKey)?.configuration.prompt ?? stepKey,
  describe,
  stepType: (stepKey) => STEPS.get(stepKey)?.configuration.stepType,
  optionsFor,
  editorFor: (stepKey) => groupOf(stepKey)?.id,
  reviewGroups: [
    {
      label: "Company",
      stepKeys: [S.intent, S.companyName, S.website, S.country, S.stage],
    },
    { label: "Product", stepKeys: [S.description, S.categories] },
    { label: "Evidence", stepKeys: [S.materials] },
    {
      label: "Team",
      stepKeys: [
        S.founderRole,
        S.founderCount,
        S.fullTime,
        S.teamSize,
        S.functions,
      ],
    },
    {
      label: "Traction",
      stepKeys: [S.signal, S.pilots, S.revenueStatus, S.customers, S.growth],
    },
    {
      label: "Raise",
      stepKeys: [
        S.raising,
        S.currency,
        S.targetAmount,
        S.instrument,
        S.timeframe,
        S.useOfFunds,
      ],
    },
    { label: "Unknowns", stepKeys: [S.followUp] },
  ],
  finalStepKeys: [S.snapshot],
};
