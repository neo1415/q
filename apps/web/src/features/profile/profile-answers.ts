import type {
  CapitalObjectiveDto,
  OnboardingSessionView,
} from "@capital-q/contracts";
import {
  FOUNDER_STEPS,
  instrumentLabel,
  STAGE_OPTIONS,
} from "@capital-q/founder-onboarding";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { FOUNDER_VOCABULARY } from "@/features/founder-onboarding/conversation-adapter";
import { INVESTOR_VOCABULARY } from "@/features/investor-onboarding/conversation-adapter";
import {
  reviewLines,
  type JourneyVocabulary,
} from "@/features/onboarding-conversation/conversation";

/**
 * What the person answered in onboarding, as their profile shows it (R25).
 *
 * Pure: a reading of the onboarding session the API returned for this
 * person, grouped for a profile rather than for the interview. Steps the
 * profile already edits as declared fields (a company's name, website,
 * country, stage and description; an investor's name, type and deployment)
 * are left out so nothing appears twice. A step on the person's path that
 * has no answer is `null` -- "Not added" on screen, never zero -- and a
 * step off their path is not listed at all.
 *
 * Money stays a decimal string with its currency: amounts are grouped for
 * reading, never parsed into floating point.
 */

export type ProfileJourney = "founder" | "investor";

export type AnswerLine = {
  readonly stepKey: string;
  readonly title: string;
  readonly value: string | null;
};

export type AnswerGroup = {
  readonly id: string;
  readonly label: string;
  readonly lines: readonly AnswerLine[];
};

const F = FOUNDER_STEPS;
const I = INVESTOR_STEPS;

type GroupSpec = {
  readonly id: string;
  readonly label: string;
  readonly stepKeys: readonly string[];
};

/**
 * Founder groups. The company's own editable fields sit above them; the
 * F7 follow-up note is founder-private working material and the materials
 * live under Pitch & media, so neither is repeated here.
 */
const FOUNDER_GROUPS: readonly GroupSpec[] = [
  { id: "sector", label: "Sector", stepKeys: [F.categories] },
  {
    id: "team",
    label: "Team",
    stepKeys: [
      F.founderRole,
      F.founderCount,
      F.fullTime,
      F.teamSize,
      F.functions,
    ],
  },
  {
    id: "traction",
    label: "Traction",
    stepKeys: [F.signal, F.pilots, F.revenueStatus, F.customers, F.growth],
  },
  {
    id: "raise",
    label: "Raise",
    stepKeys: [
      F.raising,
      F.targetAmount,
      F.instrument,
      F.timeframe,
      F.useOfFunds,
    ],
  },
];

/** Investor groups: the role, then the mandate as the investor declared it. */
const INVESTOR_GROUPS: readonly GroupSpec[] = [
  { id: "role", label: "Your role", stepKeys: [I.businessTitle] },
  {
    id: "cheque",
    label: "Cheque size",
    stepKeys: [I.chequeMin, I.chequeTypical, I.chequeMax, I.investmentRole],
  },
  { id: "stages", label: "Stages", stepKeys: [I.stages] },
  {
    id: "geography",
    label: "Geographies",
    stepKeys: [I.geography, I.geographyStrength],
  },
  {
    id: "sectors",
    label: "Sectors",
    stepKeys: [I.sectors, I.sectorStrength, I.sectorsAvoid],
  },
  {
    id: "thesis",
    label: "Thesis",
    stepKeys: [I.additionalContext, I.customCriteria],
  },
  {
    id: "preferences",
    label: "What you look for",
    stepKeys: [
      I.businessModels,
      I.customerTypes,
      I.capitalIntensity,
      I.regulatoryAppetite,
      I.revenueState,
      I.founderPreferences,
      I.founderStrength,
      I.greenFlags,
      I.greenFlagStrength,
    ],
  },
  {
    id: "exclusions",
    label: "Exclusions",
    stepKeys: [I.avoid, I.hardExclusions, I.sectorExclusions],
  },
  {
    id: "discovery",
    label: "Discovery",
    stepKeys: [I.portfolio, I.discoveryMode, I.inboundPreference],
  },
];

/** Profile titles where the interview's short title reads oddly on a page. */
const TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  [I.chequeMin]: "Smallest",
  [I.chequeTypical]: "Typical",
  [I.chequeMax]: "Largest",
  [I.additionalContext]: "In your words",
  [F.targetAmount]: "Target",
};

/** Steps whose answers name taxonomy nodes, which the page labels. */
export const TAXONOMY_STEP_KEYS: ReadonlySet<string> = new Set([
  F.categories,
  I.geography,
  I.sectors,
  I.sectorsAvoid,
  I.businessModels,
  I.customerTypes,
  I.sectorExclusions,
]);

/** Money steps and the step holding their currency. */
const MONEY_STEPS: Readonly<Record<string, string>> = {
  [I.chequeMin]: I.currency,
  [I.chequeTypical]: I.currency,
  [I.chequeMax]: I.currency,
  [F.targetAmount]: F.currency,
};

function journeyOf(journey: ProfileJourney): {
  readonly vocabulary: JourneyVocabulary;
  readonly groups: readonly GroupSpec[];
} {
  return journey === "founder"
    ? { vocabulary: FOUNDER_VOCABULARY, groups: FOUNDER_GROUPS }
    : { vocabulary: INVESTOR_VOCABULARY, groups: INVESTOR_GROUPS };
}

/** The taxonomy ids the shown answers name, for the page to label (at most 40). */
export function taxonomyIdsIn(view: OnboardingSessionView): readonly string[] {
  const ids = new Set<string>();
  for (const response of view.responses) {
    if (
      TAXONOMY_STEP_KEYS.has(response.stepKey) &&
      response.value.type === "RESOURCE_REFERENCE"
    ) {
      for (const id of response.value.resourceIds) ids.add(id);
    }
  }
  return [...ids].slice(0, 40);
}

function currencyOf(
  view: OnboardingSessionView,
  stepKey: string,
): string | null {
  const response = view.responses.find((entry) => entry.stepKey === stepKey);
  if (response === undefined) return null;
  const value = response.value;
  if (value.type === "SINGLE_SELECT") return value.optionKey.toUpperCase();
  if (value.type === "TEXT") return value.text.toUpperCase();
  return null;
}

function moneyValue(
  view: OnboardingSessionView,
  stepKey: string,
  currencyStep: string,
): string | null {
  const response = view.responses.find((entry) => entry.stepKey === stepKey);
  if (response === undefined || response.value.type !== "RANGE") return null;
  const amount = formatAmountForDisplay(response.value.value);
  const currency = currencyOf(view, currencyStep);
  return currency === null ? amount : `${currency} ${amount}`;
}

/** The onboarding answers as profile groups. */
export function answerGroups(
  journey: ProfileJourney,
  view: OnboardingSessionView,
  labels: Readonly<Record<string, string>> = {},
): readonly AnswerGroup[] {
  const { vocabulary, groups } = journeyOf(journey);
  const lines = reviewLines(
    view,
    { ...vocabulary, reviewGroups: groups },
    labels,
  );
  return lines.map((group) => {
    const spec = groups.find((candidate) => candidate.label === group.label);
    return {
      id: spec?.id ?? group.label.toLowerCase(),
      label: group.label,
      lines: group.items.map((item) => {
        const currencyStep = MONEY_STEPS[item.stepKey];
        return {
          stepKey: item.stepKey,
          title: TITLE_OVERRIDES[item.stepKey] ?? item.title,
          value:
            currencyStep === undefined || item.value === null
              ? item.value
              : moneyValue(view, item.stepKey, currencyStep),
        };
      }),
    };
  });
}

const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);

/**
 * The raise as the canonical capital objective states it. Once an
 * objective exists it is the raise -- edited on Capital or through Q --
 * so the profile reads it rather than the onboarding answer it came from.
 */
export function raiseFromObjective(
  objective: CapitalObjectiveDto,
): AnswerGroup {
  const code = (map: ReadonlyMap<string, string>, value: string | null) =>
    value === null ? null : (map.get(value) ?? value.replace(/_/g, " "));
  return {
    id: "raise",
    label: "Raise",
    lines: [
      {
        stepKey: F.targetAmount,
        title: "Target",
        value: `${objective.target.currency} ${formatAmountForDisplay(objective.target.amount)}`,
      },
      {
        stepKey: F.instrument,
        title: "Instrument",
        value:
          objective.instrumentCode === null
            ? null
            : (instrumentLabel(objective.instrumentCode) ??
              objective.instrumentCode.replace(/_/g, " ")),
      },
      {
        stepKey: "objective.stage",
        title: "Round stage",
        value: code(STAGE_LABELS, objective.targetStage),
      },
      {
        stepKey: F.useOfFunds,
        title: "Use of funds",
        value:
          objective.useOfFundsSummary === null ||
          objective.useOfFundsSummary.length === 0
            ? null
            : objective.useOfFundsSummary,
      },
    ],
  };
}
