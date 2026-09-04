/**
 * Transport-neutral onboarding failures. Session lookups are enumeration-
 * safe: a session owned by someone else reads as absent. Runtime
 * configuration faults carry a safe internal code for logs and are redacted
 * for clients.
 */

export class OnboardingDefinitionInvalidError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    // Reference data integrity: reasons name manifest step keys, never user data.
    super(`The onboarding definition is not valid: ${reasons.join("; ")}`);
    this.name = "OnboardingDefinitionInvalidError";
    this.reasons = reasons;
  }
}

/** Same journey + version published again with a different manifest. */
export class OnboardingDefinitionConflictError extends Error {
  constructor() {
    super(
      "A different manifest was already published for this journey version.",
    );
    this.name = "OnboardingDefinitionConflictError";
  }
}

/** No ACTIVE definition with a published current version exists for the journey. */
export class OnboardingDefinitionUnavailableError extends Error {
  constructor() {
    super("This onboarding journey is not available.");
    this.name = "OnboardingDefinitionUnavailableError";
  }
}

export class OnboardingSessionNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "OnboardingSessionNotFoundError";
  }
}

export class OnboardingSuggestionNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "OnboardingSuggestionNotFoundError";
  }
}

export class OnboardingSubjectNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "OnboardingSubjectNotFoundError";
  }
}

/** expectedSessionVersion did not match: another tab or request moved first. */
export class OnboardingSessionVersionConflictError extends Error {
  constructor() {
    super(
      "The onboarding session changed since it was read. Reload and retry.",
    );
    this.name = "OnboardingSessionVersionConflictError";
  }
}

/** Idempotency-Key reused with a different payload. */
export class OnboardingMutationConflictError extends Error {
  constructor() {
    super("This Idempotency-Key was already used with a different request.");
    this.name = "OnboardingMutationConflictError";
  }
}

export const ONBOARDING_STATE_REASONS = [
  "SESSION_NOT_ACTIVE",
  "STEP_NOT_ELIGIBLE",
  "STEP_REQUIRED",
  "STEP_NOT_VISITED",
  "NO_PREVIOUS_STEP",
  "REQUIRED_STEPS_INCOMPLETE",
  "SUGGESTION_ALREADY_RESOLVED",
  "SUGGESTION_STEP_MISMATCH",
  "SUBJECT_ALREADY_BOUND",
  "CONTEXT_ALREADY_BOUND",
  "UNBOUND_START_NOT_ALLOWED",
  "SUBJECT_TYPE_MISMATCH",
] as const;
export type OnboardingStateReason = (typeof ONBOARDING_STATE_REASONS)[number];

/** The requested transition is not allowed from the session's current state. */
export class OnboardingSessionStateError extends Error {
  readonly reason: OnboardingStateReason;

  constructor(reason: OnboardingStateReason) {
    super("The onboarding session does not allow this action right now.");
    this.name = "OnboardingSessionStateError";
    this.reason = reason;
  }
}

/** The operation needs a resolved organisation context the actor does not have. */
export class OnboardingContextRequiredError extends Error {
  constructor() {
    super("An active organisation context is required for this action.");
    this.name = "OnboardingContextRequiredError";
  }
}

export const ONBOARDING_RUNTIME_FAULTS = [
  "WRITE_TARGET_HANDLER_MISSING",
  "SUBJECT_RESOLVER_MISSING",
  "DEFINITION_STEP_MISSING",
  "DEFINITION_VERSION_MISSING",
] as const;
export type OnboardingRuntimeFault = (typeof ONBOARDING_RUNTIME_FAULTS)[number];

/**
 * A published definition or the runtime wiring is inconsistent (for
 * example a step declares a write target nobody registered). Nothing is
 * persisted; clients see a generic failure while the safe code is logged.
 */
export class OnboardingRuntimeConfigurationError extends Error {
  readonly fault: OnboardingRuntimeFault;
  readonly detail: string;

  constructor(fault: OnboardingRuntimeFault, detail: string) {
    super("The onboarding runtime is not correctly configured.");
    this.name = "OnboardingRuntimeConfigurationError";
    this.fault = fault;
    this.detail = detail;
  }
}
