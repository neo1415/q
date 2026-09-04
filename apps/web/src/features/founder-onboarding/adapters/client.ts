import type {
  FounderOnboardingSessionView,
  StepResponse,
  TaxonomyCandidateView,
} from "../models/presentation";

/**
 * The frontend-facing port for founder onboarding.
 *
 * Screens and the controller depend on this interface only. It is
 * implemented once, over the onboarding runtime contract, and that
 * implementation is fed either by the real API (server actions) or by the
 * in-memory development fixture. Every mutation returns the whole session
 * view so the UI never merges partial state locally.
 */
export type FounderOnboardingClient = {
  /** The founder's current session, started if none exists yet. */
  readonly getSession: () => Promise<FounderOnboardingSessionView>;
  readonly saveResponse: (input: {
    readonly stepId: string;
    readonly response: StepResponse;
  }) => Promise<FounderOnboardingSessionView>;
  readonly goBack: (input: {
    readonly stepId: string;
  }) => Promise<FounderOnboardingSessionView>;
  readonly skipStep: (input: {
    readonly stepId: string;
  }) => Promise<FounderOnboardingSessionView>;
  /** Reopen an already visited screen (e.g. "keep improving" from the snapshot). */
  readonly openStep: (input: {
    readonly stepId: string;
  }) => Promise<FounderOnboardingSessionView>;
  /** Journey completion only: not visibility, readiness or verification. */
  readonly complete: () => Promise<FounderOnboardingSessionView>;
  /** Deterministic taxonomy candidates for the founder's own text. Never assigned here. */
  readonly findTaxonomyCandidates: (input: {
    readonly text: string;
  }) => Promise<readonly TaxonomyCandidateView[]>;
};

export const CLIENT_FAILURE_KINDS = [
  "NETWORK",
  "REJECTED",
  "CONFLICT",
  "UNAVAILABLE",
] as const;
export type ClientFailureKind = (typeof CLIENT_FAILURE_KINDS)[number];

/**
 * A frontend outcome, not an HTTP envelope. The API adapter translates
 * ProblemDetails into this; the fixture raises it directly.
 *
 *   NETWORK      transient; the same operation may be retried
 *   REJECTED     the server refused the input; the founder must change it
 *   CONFLICT     the session moved on elsewhere (another tab); reload first
 *   UNAVAILABLE  no backend on this build, or a journey version this build
 *                cannot present
 */
export class FounderOnboardingClientError extends Error {
  readonly kind: ClientFailureKind;
  readonly retryable: boolean;

  constructor(kind: ClientFailureKind, message: string) {
    super(message);
    this.name = "FounderOnboardingClientError";
    this.kind = kind;
    this.retryable = kind === "NETWORK";
  }
}
