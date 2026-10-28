import type {
  OnboardingJourneyType,
  SayOnboardingResponse,
} from "@capital-q/contracts";

import {
  onboardingAnswerQuestionAction,
  onboardingCandidatesAction,
  onboardingDismissQuestionAction,
  onboardingSayAction,
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
  onboardingThreadTurnsAction,
  type ActionResult,
} from "./api-actions";
import { settledReplyFromThread } from "./reply-stream-state";
import {
  materialListAction,
  materialUploadCompleteAction,
  materialUploadTargetAction,
} from "./material-actions";
import { OnboardingClientError } from "./client";
import { sayStreamed } from "./say-stream";
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
      "Couldn't reach Capital Q. Try again.",
    );
  }
  return unwrap(result);
}

/**
 * D2 (live typed run 2026-10-28): a streamed turn that has gone quiet is
 * settled from the record. The server keeps the thread and the session;
 * once the thread carries Q's reply to these exact words, the session is
 * re-read and the turn is returned as the stream would have returned it.
 * Nothing is inferred from the reply: what was recorded is in the view.
 * Null while the thread does not yet answer, so the stream is waited on.
 */
export async function settleFromThread(
  sessionId: string,
  said: string,
): Promise<SayOnboardingResponse | null> {
  const turns = await onboardingThreadTurnsAction(sessionId);
  const reply = settledReplyFromThread(turns, said);
  if (reply === null) return null;
  const view = await onboardingGetAction(sessionId);
  if (!view.ok) return null;
  return {
    view: view.value,
    understood: null,
    reply,
    navigate: null,
    researching: null,
    degraded: false,
    askingAbout: [],
    pending: { recommendations: [], held: [] },
  };
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
    answerQuestion: (request) =>
      through(onboardingAnswerQuestionAction(request)),
    dismissQuestion: (request) =>
      through(onboardingDismissQuestionAction(request)),
    // Turn latency L9: with a listener, the turn is streamed and Q's reply
    // shows a sentence at a time; a stream that never opened falls back to
    // the server action (no turn ran, so nothing is done twice).
    say: async ({ onSentence, onStage, ...request }) => {
      if (onSentence !== undefined) {
        const streamed = await sayStreamed(
          request,
          onSentence,
          undefined,
          onStage,
          {
            onStall: () => settleFromThread(request.sessionId, request.text),
          },
        );
        if (streamed !== null) return streamed;
      }
      return through(onboardingSayAction(request));
    },

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
          message: "We couldn't upload that file. Try again.",
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
