import {
  founderCandidatesAction,
  founderCompleteAction,
  founderCurrentAction,
  founderDescribeNodesAction,
  founderGetAction,
  founderNavigateAction,
  founderSkipAction,
  founderStartAction,
  founderSubmitAction,
  type ActionResult,
} from "./api-actions";
import { FounderOnboardingClientError } from "./client";
import type { RuntimePort } from "./runtime-port";

export const API_ADAPTER_NAME = "FounderOnboardingApiClient";

function unwrap<T>(result: ActionResult<T>): T {
  if (result.ok) {
    return result.value;
  }
  throw new FounderOnboardingClientError(result.kind, result.message);
}

async function through<T>(call: Promise<ActionResult<T>>): Promise<T> {
  let result: ActionResult<T>;
  try {
    result = await call;
  } catch {
    // A failed server-action round trip (offline, deploy in progress).
    throw new FounderOnboardingClientError(
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
export function createApiRuntimePort(): RuntimePort {
  return {
    current: () => through(founderCurrentAction()),
    start: (idempotencyKey) => through(founderStartAction(idempotencyKey)),
    get: (sessionId) => through(founderGetAction(sessionId)),
    submit: (input) => through(founderSubmitAction(input)),
    skip: (input) => through(founderSkipAction(input)),
    navigate: (input) => through(founderNavigateAction(input)),
    complete: (input) => through(founderCompleteAction(input)),
    candidates: (text) => through(founderCandidatesAction(text)),
    describeNodes: (ids) => through(founderDescribeNodesAction(ids)),
  };
}
