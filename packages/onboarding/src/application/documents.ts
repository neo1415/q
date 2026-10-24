/**
 * Documents during onboarding (lane ob1, directive 2026-10-16).
 *
 * Which uploads onboarding may READ to fill coverage, and which it may only
 * acknowledge. Suitable, non-sensitive material (a pitch deck, a company or
 * product profile) is read in the background and turned into suggestions
 * the person confirms. Anything else -- financials, legal, corporate,
 * customer or data-room material, or anything the uploader classed as
 * highly confidential -- is acknowledged and recorded by its metadata only:
 * onboarding has no authorised purpose to read it, so it never does.
 *
 * Deterministic and conservative: an unknown type is metadata only. What
 * type an upload is comes from its content (QA QO-23: the document worker
 * reads its opening pages), never from its file name.
 */

export const ONBOARDING_READABLE_DOCUMENT_TYPES = [
  "PITCH_DECK",
  "COMPANY_PROFILE",
  "PRODUCT",
  // An investor's own fund deck and thesis (ob2's types). LP_LETTER is
  // deliberately absent: private, metadata only.
  "FUND_DECK",
  "INVESTMENT_THESIS",
] as const;

const READABLE = new Set<string>(ONBOARDING_READABLE_DOCUMENT_TYPES);
const TOO_SENSITIVE = new Set(["HIGHLY_CONFIDENTIAL", "RESTRICTED"]);

export type OnboardingDocumentTreatment = "READ_FOR_COVERAGE" | "METADATA_ONLY";

export function onboardingDocumentTreatment(document: {
  readonly documentType: string;
  readonly sensitivityClass: string;
}): OnboardingDocumentTreatment {
  return READABLE.has(document.documentType) &&
    !TOO_SENSITIVE.has(document.sensitivityClass)
    ? "READ_FOR_COVERAGE"
    : "METADATA_ONLY";
}
