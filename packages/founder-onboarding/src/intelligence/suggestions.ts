import type { FounderFactKey } from "@capital-q/q-core";

import type { FounderCandidate, FounderSuggestionDraft } from "./contracts.js";
import { stepForFactKey } from "./mapping.js";

/**
 * Turning what Q read into something a founder can accept or reject
 * (CQ-Q-021 §19, §20, §21, §51).
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
 */

/** How a source is named in a suggestion's refs. Bounded, opaque, no URL. */
export const FOUNDER_SOURCE_REF_TYPES = {
  document: "EVIDENCE_DOCUMENT",
  documentVersion: "EVIDENCE_DOCUMENT_VERSION",
} as const;

/**
 * Keys whose journey step takes a plain string answer.
 *
 * Everything else — a select, a range, a multi-select — needs a value in
 * that step's own shape, and guessing one would produce a suggestion the
 * runtime rejects at validation. Rather than emit a value that cannot be
 * stored, those candidates are surfaced in the review context as
 * information without a one-tap accept. Widening this set means teaching
 * the mapper that step's vocabulary, deliberately.
 */
const FREE_TEXT_KEYS: ReadonlySet<FounderFactKey> = new Set<FounderFactKey>([
  "company_name",
  "website",
  "description",
  // `use_of_funds` is deliberately absent: its step is a multi_select over
  // a fixed vocabulary, so a { type: "TEXT" } value for it is refused by
  // the runtime every time. Its candidates reach the founder through the
  // review list instead, which is what this set's own comment asks for.
]);

export function isDirectlySuggestable(key: FounderFactKey): boolean {
  return FREE_TEXT_KEYS.has(key) && stepForFactKey(key) !== null;
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
      // The step's own response shape, discriminator included. Every one of
      // these keys is a free-text step, and the onboarding contract's
      // response value is a union tagged by `type`: without it the runtime
      // refuses the suggestion, which is exactly what it should do.
      suggestedValue: { type: "TEXT", text: candidate.value },
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
