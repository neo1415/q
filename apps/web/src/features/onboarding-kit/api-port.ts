import type { OnboardingJourneyType } from "@capital-q/contracts";

import {
  onboardingCandidatesAction,
  onboardingCompleteAction,
  onboardingCurrentAction,
  onboardingDescribeNodesAction,
  onboardingGetAction,
  onboardingListNodesAction,
  onboardingNavigateAction,
  onboardingResolveSuggestionAction,
  onboardingSkipAction,
  onboardingStartAction,
  onboardingSubmitAction,
  type ActionResult,
} from "./api-actions";
import {
  materialListAction,
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "./material-actions";
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
    resolveSuggestion: (request) =>
      through(onboardingResolveSuggestionAction(request)),

    /**
     * The real Evidence upload, in the three steps the API actually has
     * (CQ-C5-R2B §7): ask permission, put the bytes straight into private
     * storage from the browser, then let the server verify what landed and
     * freeze an immutable version. The bytes never travel through the
     * application server, and the session token never reaches the browser.
     */
    uploadMaterial: async (input) => {
      const target = await materialUploadTargetAction({
        companyId: input.companyId,
        documentType: input.documentType,
        filename: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
      });
      if (!target.ok) {
        return { ok: false, message: target.message };
      }
      const put = await fetch(target.value.url, {
        method: target.value.method,
        headers: target.value.headers,
        body: input.file,
      });
      if (!put.ok) {
        // The bytes did not land. The upload session is left unfinished
        // rather than completed over nothing.
        return {
          ok: false,
          message: "We couldn't upload that file. Please try again.",
        };
      }
      const completed = await materialUploadCompleteAction(
        target.value.uploadSessionId,
      );
      return completed.ok
        ? { ok: true, documentId: completed.value.documentId }
        : { ok: false, message: completed.message };
    },
    listMaterials: (companyId) => through(materialListAction(companyId)),
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
