import type { TaxonomyClassificationStrategy } from "@capital-q/contracts";

/**
 * Transport-neutral classification failures. Run and candidate lookups are
 * enumeration-safe: a run in another tenant reads as absent.
 */

/** SEMANTIC / MODEL strategies have ports but no adapter in this release. */
export class TaxonomyClassifierNotAvailableError extends Error {
  readonly code = "CLASSIFIER_NOT_AVAILABLE" as const;
  readonly strategy: TaxonomyClassificationStrategy;

  constructor(strategy: TaxonomyClassificationStrategy) {
    super(`No taxonomy classifier is available for strategy ${strategy}.`);
    this.name = "TaxonomyClassifierNotAvailableError";
    this.strategy = strategy;
  }
}

export class TaxonomyClassificationRunNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "TaxonomyClassificationRunNotFoundError";
  }
}

export class TaxonomyClassificationCandidateNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "TaxonomyClassificationCandidateNotFoundError";
  }
}

/** A candidate already carries a decision; decisions are history, not toggles. */
export class TaxonomyClassificationCandidateDecidedError extends Error {
  constructor() {
    super("The classification candidate has already been decided.");
    this.name = "TaxonomyClassificationCandidateDecidedError";
  }
}

export const TAXONOMY_CLASSIFICATION_INPUT_REASONS = [
  "UNSUPPORTED_INPUT_SOURCE",
  "INPUT_SOURCE_SUBJECT_MISMATCH",
  "UNSUPPORTED_SUBJECT",
] as const;
export type TaxonomyClassificationInputReason =
  (typeof TAXONOMY_CLASSIFICATION_INPUT_REASONS)[number];

/** A persistent classification input is malformed in a way the caller can fix. */
export class TaxonomyClassificationInputError extends Error {
  readonly reason: TaxonomyClassificationInputReason;

  constructor(reason: TaxonomyClassificationInputReason) {
    super("The classification input is not valid.");
    this.name = "TaxonomyClassificationInputError";
    this.reason = reason;
  }
}
