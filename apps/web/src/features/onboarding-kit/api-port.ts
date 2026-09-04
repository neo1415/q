import type { OnboardingJourneyType } from "@capital-q/contracts";

import {
  onboardingCandidatesAction,
  onboardingCompleteAction,
  onboardingCurrentAction,
  onboardingDescribeNodesAction,
  onboardingGetAction,
  onboardingListNodesAction,
  onboardingNavigateAction,
  onboardingSkipAction,
  onboardingStartAction,
  onboardingSubmitAction,
  type ActionResult,
} from "./api-actions";
import { OnboardingClientError } from "./client";
import type { RuntimePort } from "./runtime-port";

export const API_ADAPTER_NAME = "OnboardingApiClient";

function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new OnboardingClientError(result.kind, result.message);
}

async function through<T>(call: Promise<ActionResult<T>>): Promise<T> {
  let result: ActionResult<T>;
  try {
    result = await call;
  } catch {
    // A failed server-action round trip (offline, deploy in progress).
    throw new OnboardingClientError(
      "NETWORK",
      "Couldn't reach Capital Q. Please try again.",
    );
  }
  return unwrap(result);
}

/**
 * The real runtime, one server action per call. The browser never holds a
 * token or an API URL; it holds only session and step identifiers, which
 * the server re-authorises on every request.
 */
export function createApiRuntimePort(input: {
  readonly journeyType: OnboardingJourneyType;
  /** Vocabularies the journey's category screens draw candidates from. */
  readonly candidateVocabularies: readonly string[];
}): RuntimePort {
  return {
    current: () => through(onboardingCurrentAction(input.journeyType)),
    start: (idempotencyKey) =>
      through(onboardingStartAction(input.journeyType, idempotencyKey)),
    get: (sessionId) => through(onboardingGetAction(sessionId)),
    submit: (request) => through(onboardingSubmitAction(request)),
    skip: (request) => through(onboardingSkipAction(request)),
    navigate: (request) => through(onboardingNavigateAction(request)),
    complete: (request) => through(onboardingCompleteAction(request)),
    candidates: (text) =>
      through(
        onboardingCandidatesAction({
          text,
          vocabularyCodes: [...input.candidateVocabularies],
        }),
      ),
    describeNodes: (ids) => through(onboardingDescribeNodesAction(ids)),
    listNodes: (vocabularyCode) =>
      through(onboardingListNodesAction(vocabularyCode)),
  };
}
