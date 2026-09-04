/**
 * The frontend-facing port for an onboarding journey, generic over the
 * journey's presentation view and composite responses. Screens and the
 * controller depend on this interface only; it is implemented once over the
 * onboarding runtime contract and fed by the real API or a dev fixture.
 * Every mutation returns the whole session view.
 */
export type OnboardingClient<TView, TResponse> = {
  /** The current session, started if none exists yet. */
  readonly getSession: () => Promise<TView>;
  readonly saveResponse: (input: {
    readonly stepId: string;
    readonly response: TResponse;
  }) => Promise<TView>;
  readonly goBack: (input: { readonly stepId: string }) => Promise<TView>;
  readonly skipStep: (input: { readonly stepId: string }) => Promise<TView>;
  /** Reopen an already visited screen. */
  readonly openStep: (input: { readonly stepId: string }) => Promise<TView>;
  /** Journey completion only: not visibility, readiness or verification. */
  readonly complete: () => Promise<TView>;
  /** Deterministic taxonomy candidates for the user's own text. Never assigned here. */
  readonly findTaxonomyCandidates: (input: {
    readonly text: string;
  }) => Promise<readonly TaxonomyCandidateView[]>;
};

/** A canonical taxonomy node offered for confirmation. Never auto-assigned. */
export type TaxonomyCandidateView = {
  readonly nodeId: string;
  readonly label: string;
  readonly vocabularyLabel: string;
  /** Short observable reason from the deterministic classifier. */
  readonly reason?: string | undefined;
};

export const CLIENT_FAILURE_KINDS = [
  "NETWORK",
  "REJECTED",
  "CONFLICT",
  "UNAVAILABLE",
] as const;
export type ClientFailureKind = (typeof CLIENT_FAILURE_KINDS)[number];

/**
 * A frontend outcome, not an HTTP envelope.
 *
 *   NETWORK      transient; the same operation may be retried
 *   REJECTED     the server refused the input; the user must change it
 *   CONFLICT     the session moved on elsewhere (another tab); reload first
 *   UNAVAILABLE  no backend on this build, or a journey version this build
 *                cannot present
 */
export class OnboardingClientError extends Error {
  readonly kind: ClientFailureKind;
  readonly retryable: boolean;

  constructor(kind: ClientFailureKind, message: string) {
    super(message);
    this.name = "OnboardingClientError";
    this.kind = kind;
    this.retryable = kind === "NETWORK";
  }
}

/** The client composed when no backend is configured: honest, never a fixture. */
export function createUnavailableClient<TView, TResponse>(
  message = "Setup isn't available on this build yet.",
): OnboardingClient<TView, TResponse> {
  const unavailable = () =>
    Promise.reject(new OnboardingClientError("UNAVAILABLE", message));
  return {
    getSession: unavailable,
    saveResponse: unavailable,
    goBack: unavailable,
    skipStep: unavailable,
    openStep: unavailable,
    complete: unavailable,
    findTaxonomyCandidates: unavailable,
  };
}
