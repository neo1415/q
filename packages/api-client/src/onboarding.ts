import {
  IDEMPOTENCY_KEY_HEADER,
  ONBOARDING_BACK_SEGMENT,
  ONBOARDING_COMPLETE_SEGMENT,
  ONBOARDING_PATH,
  ONBOARDING_RESOLVE_SEGMENT,
  ONBOARDING_RESPONSES_SEGMENT,
  ONBOARDING_SESSIONS_SEGMENT,
  ONBOARDING_SKIP_SEGMENT,
  ONBOARDING_STEPS_SEGMENT,
  ONBOARDING_SUGGESTIONS_SEGMENT,
  OnboardingSessionViewSchema,
  type CompleteOnboardingSessionRequest,
  type OnboardingBackRequest,
  type ResolveOnboardingSuggestionRequest,
  type SkipOnboardingStepRequest,
  type StartOnboardingSessionRequest,
  type SubmitOnboardingResponseRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The generic onboarding runtime client. Every call returns the whole
 * session view, so a screen never merges partial state locally. Journey-
 * specific adapters (Founder, Investor) are built on top of these in their
 * own packets; nothing here knows a step key.
 */

const sessions = `${ONBOARDING_PATH}${ONBOARDING_SESSIONS_SEGMENT}`;
const byId = (sessionId: string) =>
  `${sessions}/${encodeURIComponent(sessionId)}`;
const idempotent = (key: string) => ({
  headers: { [IDEMPOTENCY_KEY_HEADER]: key },
});

/** `POST /v1/onboarding/sessions` -- start, or resume the matching active session. */
export function startOnboardingSession(
  session: ApiSession,
  request: StartOnboardingSessionRequest,
  idempotencyKey: string,
) {
  return call(session, "POST", sessions, OnboardingSessionViewSchema, {
    body: request,
    ...idempotent(idempotencyKey),
  });
}

/** `GET /v1/onboarding/sessions/:sessionId` */
export function getOnboardingSession(session: ApiSession, sessionId: string) {
  return call(session, "GET", byId(sessionId), OnboardingSessionViewSchema);
}

/** `POST /v1/onboarding/sessions/:sessionId/responses` */
export function submitOnboardingResponse(
  session: ApiSession,
  sessionId: string,
  request: SubmitOnboardingResponseRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${byId(sessionId)}${ONBOARDING_RESPONSES_SEGMENT}`,
    OnboardingSessionViewSchema,
    { body: request, ...idempotent(idempotencyKey) },
  );
}

/** `POST /v1/onboarding/sessions/:sessionId/steps/:stepKey/skip` */
export function skipOnboardingStep(
  session: ApiSession,
  sessionId: string,
  stepKey: string,
  request: SkipOnboardingStepRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${byId(sessionId)}${ONBOARDING_STEPS_SEGMENT}/${encodeURIComponent(stepKey)}${ONBOARDING_SKIP_SEGMENT}`,
    OnboardingSessionViewSchema,
    { body: request, ...idempotent(idempotencyKey) },
  );
}

/** `POST /v1/onboarding/sessions/:sessionId/back` */
export function goBackInOnboarding(
  session: ApiSession,
  sessionId: string,
  request: OnboardingBackRequest,
) {
  return call(
    session,
    "POST",
    `${byId(sessionId)}${ONBOARDING_BACK_SEGMENT}`,
    OnboardingSessionViewSchema,
    { body: request },
  );
}

/** `POST /v1/onboarding/sessions/:sessionId/complete` */
export function completeOnboardingSession(
  session: ApiSession,
  sessionId: string,
  request: CompleteOnboardingSessionRequest,
) {
  return call(
    session,
    "POST",
    `${byId(sessionId)}${ONBOARDING_COMPLETE_SEGMENT}`,
    OnboardingSessionViewSchema,
    { body: request },
  );
}

/** `POST /v1/onboarding/sessions/:sessionId/suggestions/:suggestionId/resolve` */
export function resolveOnboardingSuggestion(
  session: ApiSession,
  sessionId: string,
  suggestionId: string,
  request: ResolveOnboardingSuggestionRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${byId(sessionId)}${ONBOARDING_SUGGESTIONS_SEGMENT}/${encodeURIComponent(suggestionId)}${ONBOARDING_RESOLVE_SEGMENT}`,
    OnboardingSessionViewSchema,
    { body: request, ...idempotent(idempotencyKey) },
  );
}
