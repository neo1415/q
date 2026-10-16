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
 * Deterministic and conservative: an unknown type is metadata only.
 */

export const ONBOARDING_READABLE_DOCUMENT_TYPES = [
  "PITCH_DECK",
  "COMPANY_PROFILE",
  "PRODUCT",
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

/**
 * The document type an upload is filed under, from its file name only (the
 * bytes are never read to decide this). Sensitive-sounding names win over
 * deck-sounding ones: "Deck appendix - management accounts.pdf" is filed
 * as management accounts, so it is never read during onboarding. A name
 * that says nothing is UNCLASSIFIED, which onboarding also does not read.
 */
export function classifyOnboardingUpload(filename: string): string {
  const name = filename.toLowerCase().replace(/[_.-]+/g, " ");
  const has = (pattern: RegExp) => pattern.test(name);
  if (
    has(
      /\b(management accounts?|p ?& ?l|profit and loss|balance sheet|cash ?flow|bank statements?|payroll|tax return|audited|accounts \d{4}|financial statements?)\b/,
    )
  ) {
    return "MANAGEMENT_ACCOUNTS";
  }
  if (has(/\b(financial model|forecast|projections?|budget)\b/)) {
    return "FINANCIAL_MODEL";
  }
  if (
    has(
      /\b(cap ?table|capitali[sz]ation|shareholders? agreement|sha|term ?sheet|articles|incorporation|certificate|board minutes|minutes)\b/,
    )
  ) {
    return "CORPORATE";
  }
  if (
    has(/\b(contract|agreement|nda|msa|lease|licen[cs]e|legal|ip assignment)\b/)
  ) {
    return "LEGAL";
  }
  if (has(/\b(customer list|customers|pipeline|crm export)\b/)) {
    return "CUSTOMER";
  }
  if (has(/\b(deck|pitch|investor presentation)\b/)) {
    return "PITCH_DECK";
  }
  if (
    has(
      /\b(one ?pager|company profile|overview|about us|introduction|brochure)\b/,
    )
  ) {
    return "COMPANY_PROFILE";
  }
  if (has(/\b(product|spec|roadmap|demo)\b/)) {
    return "PRODUCT";
  }
  return "UNCLASSIFIED";
}
