import {
  AssumptionBoardDtoSchema,
  COMPANIES_PATH,
  COMPANY_ASSUMPTIONS_SEGMENT,
  DILIGENCE_QUESTIONS_PATH,
  FIT_COMPARE_PATH,
  FIT_THESIS_PATH,
  FitComparisonDtoSchema,
  GATEQ_INVESTOR_GATES_PATH,
  IDEMPOTENCY_KEY_HEADER,
  InvestorGateFitListDtoSchema,
  InvestorMandateDtoSchema,
  MANDATE_SUGGESTION_APPLY_PATH,
  SendDiligenceQuestionsResultSchema,
  ThesisReadingDtoSchema,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Investor promises (2026-10-07). Reads are the APIs' per-reader
 * projections; the two writes are declared app actions' own routes.
 *
 *   API    assumptions (Q.07), investor gates for a founder (Q.05),
 *          send questions (Q.07), apply a thesis suggestion (Q.02)
 *   Q API  compare picked companies (Q.10), the thesis reading (Q.02)
 */

/** `GET /v1/companies/:companyId/assumptions` (investor readers only). */
export function getCompanyAssumptions(session: ApiSession, companyId: string) {
  return call(
    session,
    "GET",
    `${COMPANIES_PATH}/${encodeURIComponent(companyId)}${COMPANY_ASSUMPTIONS_SEGMENT}`,
    AssumptionBoardDtoSchema,
  );
}

/** `POST /v1/relationships/:relationshipId/diligence/questions`. */
export function sendDiligenceQuestions(
  session: ApiSession,
  relationshipId: string,
  questions: readonly string[],
  idempotencyKey: string,
  /** Per question, the assumption it came from (2026-10-08); null: their own. */
  about?: readonly ({
    readonly assumptionId: string;
    readonly label: string;
  } | null)[],
) {
  return call(
    session,
    "POST",
    DILIGENCE_QUESTIONS_PATH.replace(
      ":relationshipId",
      encodeURIComponent(relationshipId),
    ),
    SendDiligenceQuestionsResultSchema,
    {
      body: {
        questions: [...questions],
        ...(about === undefined ? {} : { about: [...about] }),
      },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** `GET /v1/gateq/investor-gates?ids=` — for a founder's own company. */
export function getInvestorGates(
  session: ApiSession,
  investorOrganisationIds: readonly string[],
) {
  return call(
    session,
    "GET",
    `${GATEQ_INVESTOR_GATES_PATH}?ids=${investorOrganisationIds.map(encodeURIComponent).join(",")}`,
    InvestorGateFitListDtoSchema,
  );
}

/** `GET /v1/fit/compare?ids=` (Q API). */
export function getFitCompare(
  session: ApiSession,
  companyIds: readonly string[],
) {
  return call(
    session,
    "GET",
    `${FIT_COMPARE_PATH}?ids=${companyIds.map(encodeURIComponent).join(",")}`,
    FitComparisonDtoSchema,
  );
}

/** `GET /v1/fit/thesis` (Q API). */
export function getThesisReading(session: ApiSession) {
  return call(session, "GET", FIT_THESIS_PATH, ThesisReadingDtoSchema);
}

/** `POST …/suggestions/:suggestionId/apply` — the investor's approval. */
export function applyThesisSuggestion(
  session: ApiSession,
  input: {
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly suggestionId: string;
    readonly expectedVersion: number;
  },
) {
  return call(
    session,
    "POST",
    MANDATE_SUGGESTION_APPLY_PATH.replace(
      ":investorOrganisationId",
      encodeURIComponent(input.investorOrganisationId),
    )
      .replace(":mandateId", encodeURIComponent(input.mandateId))
      .replace(":suggestionId", encodeURIComponent(input.suggestionId)),
    InvestorMandateDtoSchema,
    { body: { expectedVersion: input.expectedVersion } },
  );
}
