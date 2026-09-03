/**
 * Transport-neutral Permissions failures. Public messages are generic:
 * a denied or unknown resource reads identically to a caller who is not
 * entitled to learn whether it exists (TM-CTX-05). Internal reason codes
 * stay on the error for logs and audit.
 */

/** The resource could not be resolved, or the caller may not learn that it exists. */
export class DisclosureResourceNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "DisclosureResourceNotFoundError";
  }
}

/** The resource kind has no registered resolver. Never a table lookup fallback. */
export class DisclosureResourceTypeUnknownError extends Error {
  readonly resourceType: string;

  constructor(resourceType: string) {
    super("The resource type is not eligible for disclosure.");
    this.name = "DisclosureResourceTypeUnknownError";
    this.resourceType = resourceType;
  }
}

export class DisclosurePolicyNotFoundError extends Error {
  constructor() {
    super("The requested disclosure policy was not found.");
    this.name = "DisclosurePolicyNotFoundError";
  }
}

export const DISCLOSURE_POLICY_INVALID_REASONS = [
  "RECIPIENT_REQUIRED",
  "RECIPIENT_NOT_ALLOWED",
  "RELATIONSHIP_RECIPIENT_REQUIRED",
  "OWNER_UNRESOLVED",
  "PERSONAL_OWNER_REQUIRED",
  "EXPIRY_IN_PAST",
  "RELATIONSHIP_NOT_FOUND",
  "RELATIONSHIP_MISMATCH",
  "OWNER_NOT_RELATIONSHIP_PARTY",
] as const;
export type DisclosurePolicyInvalidReason =
  (typeof DISCLOSURE_POLICY_INVALID_REASONS)[number];

/** The requested policy is not a well-formed disclosure statement. */
export class DisclosurePolicyInvalidError extends Error {
  readonly reason: DisclosurePolicyInvalidReason;

  constructor(reason: DisclosurePolicyInvalidReason) {
    super("The disclosure policy is not valid.");
    this.name = "DisclosurePolicyInvalidError";
    this.reason = reason;
  }
}

/** Same DisclosurePolicyId, different canonical policy. The original is untouched. */
export class DisclosurePolicyConflictError extends Error {
  constructor() {
    super("A different disclosure policy already exists with this identifier.");
    this.name = "DisclosurePolicyConflictError";
  }
}

/** A semantically identical active grant already exists (database backstop). */
export class DisclosurePolicyExistsError extends Error {
  constructor() {
    super("An equivalent active disclosure policy already exists.");
    this.name = "DisclosurePolicyExistsError";
  }
}

/** The combined guard refused disclosure. Reason kept internal. */
export class DisclosureDeniedError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super("You do not have permission to access this resource.");
    this.name = "DisclosureDeniedError";
    this.reasonCode = reasonCode;
  }
}
