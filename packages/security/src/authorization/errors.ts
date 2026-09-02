import type {
  AuthorizationOutcome,
  AuthorizationReason,
  AuthorizationRequirement,
} from "./decision.js";

/**
 * Transport-neutral authorization failures. No HTTP status lives here; the
 * adapter decides whether a denial is a 403 or an enumeration-safe 404.
 *
 * Public messages are deliberately generic. The internal reason code is kept
 * for logs and audit but is never the message, because reasons such as
 * ORGANISATION_MISMATCH disclose facts a denied caller must not learn.
 */
export class AuthorizationDeniedError extends Error {
  readonly reasonCode: AuthorizationReason;

  constructor(reasonCode: AuthorizationReason) {
    super("You do not have permission to perform this action.");
    this.name = "AuthorizationDeniedError";
    this.reasonCode = reasonCode;
  }
}

/**
 * The capability is held but a condition is unmet. This is not permission:
 * REQUIRES_APPROVAL means approval is needed, not that it was given.
 */
export class AuthorizationRequirementError extends Error {
  readonly outcome: Exclude<AuthorizationOutcome, "ALLOW" | "DENY">;
  readonly requirements: readonly AuthorizationRequirement[];

  constructor(
    outcome: Exclude<AuthorizationOutcome, "ALLOW" | "DENY">,
    requirements: readonly AuthorizationRequirement[],
  ) {
    super("Additional verification or approval is required for this action.");
    this.name = "AuthorizationRequirementError";
    this.outcome = outcome;
    this.requirements = requirements;
  }
}
