import {
  Q_READINESS_BLUEPRINTS_PATH,
  ReadinessBlueprintDtoSchema,
  READINESS_ACTION_STATE_PATH,
  READINESS_PATH,
  READINESS_QUESTION_ANSWER_PATH,
  READINESS_QUESTION_DISMISS_PATH,
  ReadinessActionStateResultSchema,
  ReadinessDtoSchema,
  ReadinessQuestionResultSchema,
  type ReadinessQuestionAnswerRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * The founder's own readiness (Q.03), action plan (Q.04) and Q's
 * follow-up questions (Q.01). The company is the session's own; nothing
 * here names one.
 */
const fill = (path: string, values: Readonly<Record<string, string>>) =>
  Object.entries(values).reduce(
    (out, [key, value]) => out.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );

export const getReadiness = (session: ApiSession) =>
  call(session, "GET", READINESS_PATH, ReadinessDtoSchema);

export const setReadinessActionState = (
  session: ApiSession,
  actionKey: string,
  done: boolean,
) =>
  call(
    session,
    "POST",
    fill(READINESS_ACTION_STATE_PATH, { actionKey }),
    ReadinessActionStateResultSchema,
    { body: { done } },
  );

export const answerReadinessQuestion = (
  session: ApiSession,
  questionId: string,
  answer: ReadinessQuestionAnswerRequest["answer"],
  idempotencyKey: string,
) =>
  call(
    session,
    "POST",
    fill(READINESS_QUESTION_ANSWER_PATH, { questionId }),
    ReadinessQuestionResultSchema,
    { body: { answer }, headers: { "idempotency-key": idempotencyKey } },
  );

export const dismissReadinessQuestion = (
  session: ApiSession,
  questionId: string,
  idempotencyKey: string,
) =>
  call(
    session,
    "POST",
    fill(READINESS_QUESTION_DISMISS_PATH, { questionId }),
    ReadinessQuestionResultSchema,
    { body: {}, headers: { "idempotency-key": idempotencyKey } },
  );

/**
 * `POST /v1/q/readiness-blueprints` on q-api (Q.04): the founder's own plan
 * sequenced over 3, 6 or 12 months. Plan-gated: a plan without it answers
 * ENTITLEMENT_REQUIRED (ApiProblemError), never a sample plan. The company
 * must be the caller's own; anything else is the same 404.
 */
export const createReadinessBlueprint = (
  session: ApiSession,
  input: { readonly companyId: string; readonly horizonMonths: 3 | 6 | 12 },
) =>
  call(
    session,
    "POST",
    Q_READINESS_BLUEPRINTS_PATH,
    ReadinessBlueprintDtoSchema,
    {
      body: { companyId: input.companyId, horizonMonths: input.horizonMonths },
    },
  );
