import type {
  FounderOnboardingSessionView,
  StepResponse,
} from "../models/presentation";

/**
 * The frontend-facing port for founder onboarding.
 *
 * Screens and the controller depend on this interface only. Today it is
 * implemented by a deterministic development fixture; when CQ-ONB-002 lands
 * the API adapter implements the same port over @capital-q/api-client and
 * shared contracts, and nothing above this line changes.
 *
 * Every mutation returns the whole session view so the UI never merges
 * partial state locally -- the adapter is the source of the presentation.
 */
export type FounderOnboardingClient = {
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
  /** Reopen an already completed step (e.g. "keep improving" from F8). */
  readonly openStep: (input: {
    readonly stepId: string;
  }) => Promise<FounderOnboardingSessionView>;
  readonly attachFile: (input: {
    readonly stepId: string;
    readonly file: {
      readonly name: string;
      readonly sizeBytes: number;
      readonly type: string;
    };
  }) => Promise<FounderOnboardingSessionView>;
  readonly removeFile: (input: {
    readonly stepId: string;
    readonly fileId: string;
  }) => Promise<FounderOnboardingSessionView>;
  readonly retryFile: (input: {
    readonly stepId: string;
    readonly fileId: string;
  }) => Promise<FounderOnboardingSessionView>;
};

export const CLIENT_FAILURE_KINDS = [
  "NETWORK",
  "REJECTED",
  "UNAVAILABLE",
] as const;
export type ClientFailureKind = (typeof CLIENT_FAILURE_KINDS)[number];

/**
 * A frontend outcome, not an HTTP envelope. The API adapter will translate
 * ProblemDetails into this; the fixture raises it directly.
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
