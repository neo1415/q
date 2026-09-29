import type {
  CapitalObjectiveDto,
  OnboardingSessionView,
} from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_V2,
  FOUNDER_STEPS,
  instrumentLabel,
  STAGE_OPTIONS,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_STEPS,
} from "@capital-q/investor-onboarding";
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
  /** A list answer's entries, one chip each; null for a single value. */
  readonly items?: readonly string[] | null;
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

/**
 * Investor groups: the role, then the mandate as the investor declared it,
 * one card each on the profile (founder design 2026-09-28). The inbound
 * preference is the organisation's own setting (ADR 0023), shown from
 * there, not from its setup answer.
 */
const INVESTOR_GROUPS: readonly GroupSpec[] = [
  { id: "role", label: "Your role", stepKeys: [I.businessTitle] },
  {
    id: "mandate",
    label: "Investment mandate",
    stepKeys: [I.stages, I.investmentRole],
  },
  {
    id: "cheque",
    label: "Cheque size",
    stepKeys: [I.chequeMin, I.chequeTypical, I.chequeMax],
  },
  {
    id: "focus",
    label: "Investment focus",
    stepKeys: [
      I.sectors,
      I.sectorStrength,
      I.businessModels,
      I.customerTypes,
      I.geography,
      I.geographyStrength,
      I.sectorsAvoid,
    ],
  },
  {
    id: "criteria",
    label: "Investment criteria",
    stepKeys: [I.capitalIntensity, I.regulatoryAppetite, I.revenueState],
  },
  {
    id: "founder_fit",
    label: "Founder fit",
    stepKeys: [
      I.founderStrength,
      I.founderPreferences,
      I.greenFlags,
      I.greenFlagStrength,
      I.customCriteria,
    ],
  },
  {
    id: "exclusions",
    label: "Exclusions",
    stepKeys: [I.avoid, I.hardExclusions, I.sectorExclusions],
  },
  {
    id: "discovery",
    label: "Discovery preferences",
    stepKeys: [I.discoveryMode, I.portfolio],
  },
  { id: "thesis", label: "In your words", stepKeys: [I.additionalContext] },
];

/**
 * Facts a card edits beyond the ones it shows: the cheque's currency is
 * shown inside each amount, and edited beside them.
 */
export const EXTRA_EDIT_STEPS: Readonly<Record<string, readonly string[]>> = {
  cheque: [I.currency],
};

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

function stepOf(journey: ProfileJourney, stepKey: string) {
  return (
    journey === "founder" ? FOUNDER_DEFINITION_V2 : INVESTOR_DEFINITION_V1
  ).steps.find((step) => step.stepKey === stepKey);
}

/** A list answer's entries by name (options or categories); null otherwise. */
function listItems(
  journey: ProfileJourney,
  view: OnboardingSessionView,
  stepKey: string,
  labels: Readonly<Record<string, string>>,
): readonly string[] | null {
  const value = view.responses.find((r) => r.stepKey === stepKey)?.value;
  if (value === undefined) return null;
  if (value.type === "RESOURCE_REFERENCE") {
    return value.resourceIds.map((id) => labels[id] ?? "A category");
  }
  if (value.type !== "MULTI_SELECT") return null;
  const configuration = stepOf(journey, stepKey)?.configuration;
  const options =
    configuration?.stepType === "multi_select" ? configuration.options : [];
  return value.optionKeys.map(
    (key) =>
      options.find((option) => option.optionKey === key)?.label ??
      key.replace(/_/g, " "),
  );
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
  // A statement shows once (R30 #30): the same free text recorded under
  // two steps (a thesis that is also the person's own criteria) is kept
  // where it first appears. Short values ("Seed", "Yes") legitimately
  // repeat and are never folded.
  const seen = new Set<string>();
  const repeated = (value: string | null): boolean => {
    if (value === null || value.length < 40) return false;
    const key = value.trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  };
  return lines.map((group) => {
    const spec = groups.find((candidate) => candidate.label === group.label);
    return {
      id: spec?.id ?? group.label.toLowerCase(),
      label: group.label,
      lines: group.items
        .filter((item) => !repeated(item.value))
        .map((item) => {
          const currencyStep = MONEY_STEPS[item.stepKey];
          return {
            stepKey: item.stepKey,
            title: TITLE_OVERRIDES[item.stepKey] ?? item.title,
            value:
              currencyStep === undefined || item.value === null
                ? item.value
                : moneyValue(view, item.stepKey, currencyStep),
            items: listItems(journey, view, item.stepKey, labels),
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
        title: "Stage",
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
