import {
  ASSUMPTION_STANDING_LABELS,
  type AssumptionDto,
  type EvidenceStatus,
  type TruthClass,
} from "@capital-q/contracts";

/**
 * The words for an assumption's three axes, one vocabulary for the
 * profile card, the evidence board and Q's room card. Truth class and
 * evidence status are separate labels, never merged into one; Q's
 * inference is always said as Q's.
 */

export const TRUTH_WORDS: Readonly<Record<TruthClass, string>> = {
  VERIFIED: "Verified",
  USER_CLAIM: "Founder's claim",
  ESTIMATE: "Estimate",
  Q_INFERENCE: "Q's reading of the deck",
  UNKNOWN: "Not known yet",
};

export const EVIDENCE_WORDS: Readonly<Record<EvidenceStatus, string>> = {
  NO_EVIDENCE: "No evidence yet",
  SELF_REPORTED: "Self-reported",
  DOCUMENT_SUPPORTED: "Document supported",
  MULTI_SOURCE_SUPPORTED: "Several sources",
  EXTERNALLY_VERIFIED: "Externally verified",
  PLATFORM_VERIFIED: "Verified by Capital Q",
};

export const UNKNOWN_WORDS: Readonly<
  Record<NonNullable<AssumptionDto["unknownReason"]>, string>
> = {
  NOT_IN_DECK: "Not in the deck",
  UNCLEAR: "Unclear in the deck",
  CONTRADICTORY: "Figures disagree",
  NOT_SHARED: "Nothing shared with you covers this",
};

/** The labels shown beside a claim, in order. */
export function assumptionLabels(assumption: AssumptionDto): readonly string[] {
  if (assumption.standing === "UNKNOWN") {
    return [UNKNOWN_WORDS[assumption.unknownReason ?? "NOT_IN_DECK"]];
  }
  return [
    assumption.truthClass === null ? null : TRUTH_WORDS[assumption.truthClass],
    assumption.evidenceStatus === null
      ? null
      : EVIDENCE_WORDS[assumption.evidenceStatus],
    assumption.source,
  ].filter((label): label is string => label !== null);
}

export const standingWord = (assumption: AssumptionDto): string =>
  ASSUMPTION_STANDING_LABELS[assumption.standing];

export function claimLine(assumption: AssumptionDto): string {
  return assumption.value === null
    ? assumption.label
    : `${assumption.label}: ${assumption.value}`;
}
