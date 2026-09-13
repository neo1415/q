import type { OnboardingResponseValue } from "@capital-q/contracts";
import { parseFigure } from "@capital-q/onboarding";
import type { FounderFactKey } from "@capital-q/q-core";

import {
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  FULL_TIME_OPTIONS,
  FUNCTION_OPTIONS,
  FOUNDER_ROLE_OPTIONS,
  GROWTH_OPTIONS,
  INSTRUMENT_OPTIONS,
  RAISING_OPTIONS,
  REVENUE_STATUS_OPTIONS,
  SIGNAL_OPTIONS,
  STAGE_OPTIONS,
  TIMEFRAME_OPTIONS,
  USE_OF_FUNDS_OPTIONS,
} from "../definition/founder-v1.js";
import { FOUNDER_UTTERANCE_ALIASES } from "../definition/utterance-aliases.js";
import type { FounderCandidate, FounderSuggestionDraft } from "./contracts.js";
import { stepForFactKey } from "./mapping.js";

/**
 * Turning what Q read into something a founder can accept or reject
 * (CQ-Q-021 §19, §20, §21, §51; CQ-PRE-REC-001 §23).
 *
 * A candidate becomes a suggestion, never a response and never a company
 * record. The onboarding runtime already validates a suggestion against the
 * pinned step's own schema before it is stored, and accepting one creates a
 * normal validated response through the same path a typed answer takes —
 * so the confirmation gate is not something this file has to remember to
 * apply. It is the only door there is.
 *
 * What this file is responsible for is the part that would otherwise be
 * lost: provenance. Every draft carries the document and version its value
 * came from, so months later Capital Q can still answer "where did that
 * come from" with something better than "a model said so".
 *
 * Since CQ-PRE-REC-001 §23 (the document-first shortcut) a candidate for a
 * structured step is mapped onto that step's own vocabulary here,
 * deterministically: "Seed" becomes the `seed` option, "Lagos, Nigeria"
 * the `ng` option, "$3m" a range value of 3000000. A value the vocabulary
 * does not contain is not guessed; it reaches the founder through the
 * review list instead, as information without a one-tap accept.
 */

/** How a source is named in a suggestion's refs. Bounded, opaque, no URL. */
export const FOUNDER_SOURCE_REF_TYPES = {
  document: "EVIDENCE_DOCUMENT",
  documentVersion: "EVIDENCE_DOCUMENT_VERSION",
} as const;

/** Keys whose journey step takes a plain string answer. */
const FREE_TEXT_KEYS: ReadonlySet<FounderFactKey> = new Set<FounderFactKey>([
  "company_name",
  "website",
  "description",
]);

type Option = { readonly optionKey: string; readonly label: string };

/** Keys whose step is a single choice from a closed vocabulary. */
const SINGLE_SELECT_KEYS: ReadonlyMap<FounderFactKey, readonly Option[]> =
  new Map<FounderFactKey, readonly Option[]>([
    ["stage", STAGE_OPTIONS],
    ["country", COUNTRY_OPTIONS],
    ["founder_role", FOUNDER_ROLE_OPTIONS],
    ["full_time", FULL_TIME_OPTIONS],
    ["signal", SIGNAL_OPTIONS],
    ["revenue_status", REVENUE_STATUS_OPTIONS],
    ["growth", GROWTH_OPTIONS],
    ["raising", RAISING_OPTIONS],
    ["currency", CURRENCY_OPTIONS],
    ["instrument", INSTRUMENT_OPTIONS],
    ["timeframe", TIMEFRAME_OPTIONS],
  ]);

/** Keys whose step is several choices from a closed vocabulary. */
const MULTI_SELECT_KEYS: ReadonlyMap<
  FounderFactKey,
  { readonly options: readonly Option[]; readonly max: number }
> = new Map<
  FounderFactKey,
  { readonly options: readonly Option[]; readonly max: number }
>([
  ["functions", { options: FUNCTION_OPTIONS, max: 6 }],
  ["use_of_funds", { options: USE_OF_FUNDS_OPTIONS, max: 5 }],
]);

/** Keys whose step is a figure inside a range; the definition's own bounds. */
const RANGE_KEYS: ReadonlyMap<
  FounderFactKey,
  { readonly min: number; readonly max: number }
> = new Map<FounderFactKey, { readonly min: number; readonly max: number }>([
  ["founder_count", { min: 1, max: 50 }],
  ["team_size", { min: 1, max: 100_000 }],
  ["pilots", { min: 0, max: 10_000 }],
  ["customers", { min: 0, max: 10_000_000 }],
  ["target_amount", { min: 1, max: 1_000_000_000_000 }],
]);

/** Options that mean "the founder cannot say" are never proposed from a reading. */
const NEVER_PROPOSED = new Set(["unsure", "other", "none", "not_now"]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+(?=\s|$)/g, "")
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'+&/ .$£€-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(text: string, phrase: string): boolean {
  const needle = normalise(phrase);
  return needle.length > 0 && ` ${normalise(text)} `.includes(` ${needle} `);
}

function matchingOptions(
  key: FounderFactKey,
  text: string,
  options: readonly Option[],
): readonly Option[] {
  const stepKey = stepForFactKey(key);
  const aliases =
    stepKey === null ? undefined : FOUNDER_UTTERANCE_ALIASES[stepKey];
  const exact = normalise(text);
  return options.filter((option) => {
    if (NEVER_PROPOSED.has(option.optionKey)) {
      return false;
    }
    const names = [
      option.label,
      ...(option.optionKey.length >= 4
        ? [option.optionKey.replace(/_/g, " ")]
        : []),
      ...(aliases?.[option.optionKey] ?? []),
    ];
    return (
      names.some((name) => normalise(name) === exact) ||
      names.some((name) => mentions(text, name))
    );
  });
}

/**
 * The step's own response value for a candidate, or null when the reading
 * does not land unambiguously in the step's vocabulary.
 */
export function structuredValueFor(
  key: FounderFactKey,
  value: string,
): OnboardingResponseValue | null {
  if (FREE_TEXT_KEYS.has(key)) {
    const text = value.trim();
    return text.length === 0 ? null : { type: "TEXT", text };
  }
  const single = SINGLE_SELECT_KEYS.get(key);
  if (single !== undefined) {
    const matched = matchingOptions(key, value, single);
    return matched.length === 1 && matched[0] !== undefined
      ? { type: "SINGLE_SELECT", optionKey: matched[0].optionKey }
      : null;
  }
  const multi = MULTI_SELECT_KEYS.get(key);
  if (multi !== undefined) {
    const matched = matchingOptions(key, value, multi.options).slice(
      0,
      multi.max,
    );
    return matched.length === 0
      ? null
      : {
          type: "MULTI_SELECT",
          optionKeys: matched.map((option) => option.optionKey),
        };
  }
  const range = RANGE_KEYS.get(key);
  if (range !== undefined) {
    const figure = parseFigure(value);
    if (figure === null) {
      return null;
    }
    const amount = Number.parseFloat(figure);
    if (!Number.isFinite(amount) || amount < range.min || amount > range.max) {
      return null;
    }
    // Counts are whole; a money figure keeps its cents.
    return {
      type: "RANGE",
      value: key === "target_amount" ? figure : String(Math.round(amount)),
    };
  }
  return null;
}

export function isDirectlySuggestable(key: FounderFactKey): boolean {
  return (
    stepForFactKey(key) !== null &&
    (FREE_TEXT_KEYS.has(key) ||
      SINGLE_SELECT_KEYS.has(key) ||
      MULTI_SELECT_KEYS.has(key) ||
      RANGE_KEYS.has(key))
  );
}

/**
 * A confidence figure for the suggestion row.
 *
 * The categorical confidence is what Capital Q reasons with; this string
 * exists because the column does, and it is derived rather than invented —
 * a model's own number would be a precision nobody measured.
 */
function confidenceFor(candidate: FounderCandidate): string {
  if (!candidate.explicit) {
    return "0.3";
  }
  switch (candidate.confidence) {
    case "HIGH":
      return "0.9";
    case "MODERATE":
      return "0.7";
    case "LOW":
      return "0.4";
    default:
      return "0.3";
  }
}

export function draftSuggestions(
  candidates: readonly FounderCandidate[],
): readonly FounderSuggestionDraft[] {
  const drafts: FounderSuggestionDraft[] = [];
  const claimed = new Set<FounderFactKey>();

  for (const candidate of candidates) {
    if (claimed.has(candidate.key) || !isDirectlySuggestable(candidate.key)) {
      continue;
    }
    const stepKey = stepForFactKey(candidate.key);
    if (stepKey === null) {
      continue;
    }
    // The step's own response shape, discriminator included: the onboarding
    // contract's response value is a union tagged by `type`, and without
    // the right one the runtime refuses the suggestion, which is exactly
    // what it should do. A reading the vocabulary cannot hold is left for
    // the review list rather than forced into an option.
    const suggestedValue = structuredValueFor(candidate.key, candidate.value);
    if (suggestedValue === null) {
      continue;
    }
    claimed.add(candidate.key);

    const sourceRefs = candidate.origins.flatMap((origin) => [
      {
        sourceType: FOUNDER_SOURCE_REF_TYPES.document,
        sourceId: origin.documentId,
      },
      {
        sourceType: FOUNDER_SOURCE_REF_TYPES.documentVersion,
        sourceId: origin.documentVersionId,
      },
    ]);

    drafts.push({
      stepKey,
      targetField: candidate.key,
      suggestedValue,
      sourceRefs: sourceRefs.slice(0, 20),
      confidence: confidenceFor(candidate),
    });
  }

  return drafts;
}

/**
 * What a founder reads next to a suggestion (§21).
 *
 * "From your pitch deck, slide 6" — the locator, in the founder's own
 * terms. Never a storage key, never a bucket, never a document id, because
 * none of those help a person decide whether the number is right.
 */
export function describeOrigins(candidate: FounderCandidate): string | null {
  if (candidate.origins.length === 0) {
    return null;
  }
  const labels = [...new Set(candidate.origins.map((origin) => origin.label))];
  return labels.length === 1
    ? `From ${labels[0] ?? ""}`
    : `From ${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
}
