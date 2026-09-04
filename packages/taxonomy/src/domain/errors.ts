/**
 * Transport-neutral Taxonomy failures. Messages never reveal whether a
 * tenant-owned subject exists to a caller who may not know.
 */

export class TaxonomyVocabularyNotFoundError extends Error {
  constructor() {
    super("The requested taxonomy vocabulary was not found.");
    this.name = "TaxonomyVocabularyNotFoundError";
  }
}

export class TaxonomyNodeNotFoundError extends Error {
  constructor() {
    super("The requested taxonomy node was not found.");
    this.name = "TaxonomyNodeNotFoundError";
  }
}

export const TAXONOMY_NODE_NOT_SELECTABLE_REASONS = [
  "UNKNOWN_NODE",
  "DEPRECATED",
  "WRONG_VOCABULARY",
  "DUPLICATE",
  "VOCABULARY_RETIRED",
] as const;
export type TaxonomyNodeNotSelectableReason =
  (typeof TAXONOMY_NODE_NOT_SELECTABLE_REASONS)[number];

/** A node was named that cannot be assigned or preferred in this context. */
export class TaxonomyNodeNotSelectableError extends Error {
  readonly reason: TaxonomyNodeNotSelectableReason;
  readonly nodeId: string;

  constructor(reason: TaxonomyNodeNotSelectableReason, nodeId: string) {
    super("A taxonomy node in the request cannot be selected.");
    this.name = "TaxonomyNodeNotSelectableError";
    this.reason = reason;
    this.nodeId = nodeId;
  }
}

/** The subject (company ...) is not visible in the caller's context. Enumeration-safe. */
export class TaxonomySubjectNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "TaxonomySubjectNotFoundError";
  }
}

/** Reference hierarchy integrity was violated (cycle, cross-vocabulary parent, depth). */
export class TaxonomyHierarchyError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    // Reference-data integrity failure: the detail names the offending
    // platform node, never tenant data, so it may travel in the message.
    super(`The taxonomy hierarchy is not valid: ${detail}`);
    this.name = "TaxonomyHierarchyError";
    this.detail = detail;
  }
}
