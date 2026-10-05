import type { FitOutcome, FitParameter } from "@capital-q/contracts";

/**
 * Reason sentences (fit-reasons.v1; ADR 0052).
 *
 * Every sentence on a fit card comes from here, never from a model, so the
 * same inputs always read the same way and an old card still explains
 * itself as it did when it was shown (the version travels with the config).
 *
 * Each entry has a sentence with slots and a plain fallback for when a slot
 * has no value: a missing fact makes the sentence vaguer, never invented.
 * Slots are filled only with facts the reader may already see (the
 * company's discoverable profile, the investor's own mandate).
 *
 * Wording rules: unknown says what is missing, never "poor"; a low thesis
 * overlap says "little overlap", never "bad"; nothing is a number the
 * inputs did not contain.
 */

export const FIT_REASON_TEMPLATES_VERSION = "fit-reasons.v1" as const;

/** The key a template is chosen by. NO_PREFERENCE: the mandate declares nothing here. */
export type FitReasonKey = FitOutcome | "NO_PREFERENCE";

type Template = { readonly withFacts: string; readonly plain: string };

export const FIT_REASON_TEMPLATES: Readonly<
  Record<FitParameter, Readonly<Record<FitReasonKey, Template>>>
> = Object.freeze({
  STAGE: {
    STRONG: {
      withFacts: "Raising {companyStage}; you invest at {mandateStages}.",
      plain: "Their stage is one you invest at.",
    },
    PARTIAL: {
      withFacts:
        "Raising {companyStage}; you mostly invest at {mandateStages}.",
      plain: "Their stage is next to the ones you invest at.",
    },
    MISMATCH: {
      withFacts: "Raising {companyStage}; your mandate is {mandateStages}.",
      plain: "Their stage is outside the stages you invest at.",
    },
    UNKNOWN: {
      withFacts: "The company has not said its stage yet.",
      plain: "The company has not said its stage yet.",
    },
    NO_PREFERENCE: {
      withFacts: "You have not set the stages you invest at.",
      plain: "You have not set the stages you invest at.",
    },
  },
  SECTOR: {
    STRONG: {
      withFacts: "{companySector}, one of your sectors.",
      plain: "In one of your sectors.",
    },
    PARTIAL: {
      withFacts: "{companySector}, close to your sectors.",
      plain: "Close to one of your sectors.",
    },
    MISMATCH: {
      withFacts: "{companySector}, not in your sectors.",
      plain: "Not in your sectors.",
    },
    UNKNOWN: { withFacts: "Sector not set.", plain: "Sector not set." },
    NO_PREFERENCE: {
      withFacts: "You have not set your sectors.",
      plain: "You have not set your sectors.",
    },
  },
  GEOGRAPHY: {
    STRONG: {
      withFacts: "Based in {companyPlace}; you invest there.",
      plain: "Based in a country you invest in.",
    },
    PARTIAL: {
      withFacts: "Based in {companyPlace}; in a region you invest in.",
      plain: "Based in a region you invest in.",
    },
    MISMATCH: {
      withFacts: "Based in {companyPlace}; outside your regions.",
      plain: "Based outside your regions.",
    },
    UNKNOWN: { withFacts: "Location not set.", plain: "Location not set." },
    NO_PREFERENCE: {
      withFacts: "You invest anywhere.",
      plain: "You invest anywhere.",
    },
  },
  CHEQUE_SIZE: {
    STRONG: {
      withFacts: "{roundSize} round; your {chequeSize} fits.",
      plain: "Your cheque fits their round.",
    },
    PARTIAL: {
      withFacts: "{roundSize} round; your {chequeSize} is at the edge of it.",
      plain: "Your cheque is at the edge of their round.",
    },
    MISMATCH: {
      withFacts: "Raising {roundSize}; your range is {chequeRange}.",
      plain: "Their round is outside your cheque range.",
    },
    UNKNOWN: {
      withFacts: "Round size not shared.",
      plain: "Round size not shared.",
    },
    NO_PREFERENCE: {
      withFacts: "You have not set a cheque size.",
      plain: "You have not set a cheque size.",
    },
  },
  BUSINESS_MODEL: {
    STRONG: {
      withFacts: "{businessModel}, a model you prefer.",
      plain: "A business model you prefer.",
    },
    PARTIAL: {
      withFacts: "{businessModel}, neutral for you.",
      plain: "A business model you have no view on.",
    },
    MISMATCH: {
      withFacts: "{businessModel}, which you said you avoid.",
      plain: "A business model you said you avoid.",
    },
    UNKNOWN: {
      withFacts: "Business model not clear yet.",
      plain: "Business model not clear yet.",
    },
    NO_PREFERENCE: {
      withFacts: "You have no business-model preference.",
      plain: "You have no business-model preference.",
    },
  },
  TRACTION: {
    STRONG: {
      withFacts: "{revenue} a month, above your {tractionMinimum} minimum.",
      plain: "Traction meets the minimum you set.",
    },
    PARTIAL: {
      withFacts: "{revenue} a month, below your {tractionMinimum} minimum.",
      plain: "Some traction, below the minimum you set.",
    },
    MISMATCH: {
      withFacts: "Below the {tractionMinimum} a month you ask for.",
      plain: "Well below the traction you ask for.",
    },
    UNKNOWN: {
      withFacts: "No traction data shared yet.",
      plain: "No traction data shared yet.",
    },
    NO_PREFERENCE: {
      withFacts: "You have not set a traction minimum.",
      plain: "You have not set a traction minimum.",
    },
  },
  TEAM: {
    STRONG: {
      withFacts: "{team}; meets what you look for.",
      plain: "The team meets what you look for.",
    },
    PARTIAL: {
      withFacts: "{team}; part of what you look for.",
      plain: "The team meets part of what you look for.",
    },
    MISMATCH: {
      withFacts: "{team}; you require otherwise.",
      plain: "The team misses something you require.",
    },
    UNKNOWN: {
      withFacts: "Team details not added.",
      plain: "Team details not added.",
    },
    NO_PREFERENCE: {
      withFacts: "You have no team requirements.",
      plain: "You have no team requirements.",
    },
  },
  THESIS: {
    STRONG: {
      withFacts: "Close to your thesis.",
      plain: "Close to your thesis.",
    },
    PARTIAL: {
      withFacts: "Some overlap with your thesis.",
      plain: "Some overlap with your thesis.",
    },
    MISMATCH: {
      withFacts: "Little overlap with your thesis.",
      plain: "Little overlap with your thesis.",
    },
    UNKNOWN: {
      withFacts: "Not enough text to compare.",
      plain: "Not enough text to compare.",
    },
    NO_PREFERENCE: {
      withFacts: "You have not written a thesis.",
      plain: "You have not written a thesis.",
    },
  },
  ROUND_TERMS: {
    STRONG: {
      withFacts: "{roundTerms}; fits how you invest.",
      plain: "Round terms fit how you invest.",
    },
    PARTIAL: {
      withFacts: "{roundTerms}; you sometimes lead.",
      plain: "Needs a lead; you sometimes lead.",
    },
    MISMATCH: {
      withFacts: "{roundTerms}; you never lead.",
      plain: "Needs a lead; you never lead.",
    },
    UNKNOWN: {
      withFacts: "Round terms not shared.",
      plain: "Round terms not shared.",
    },
    NO_PREFERENCE: {
      withFacts: "You have not said whether you lead.",
      plain: "You have not said whether you lead.",
    },
  },
});

const SLOT = /\{([a-zA-Z]+)\}/g;

/**
 * The sentence for one parameter. Uses the slotted sentence only when
 * every slot it names has a non-empty fact; otherwise the plain one.
 */
export function renderFitReason(
  parameter: FitParameter,
  key: FitReasonKey,
  facts: Readonly<Record<string, string | undefined>>,
): string {
  const template = FIT_REASON_TEMPLATES[parameter][key];
  const slots = [...template.withFacts.matchAll(SLOT)].map((m) => m[1] ?? "");
  const complete = slots.every((slot) => {
    const value = facts[slot];
    return value !== undefined && value.trim().length > 0;
  });
  if (!complete) return template.plain;
  return template.withFacts.replace(SLOT, (_m, slot: string) =>
    (facts[slot] ?? "").trim(),
  );
}
