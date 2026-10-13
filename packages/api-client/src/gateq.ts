import { z } from "zod";

import {
  ApplicationContactConfirmResponseSchema,
  ApplicationContactResponseSchema,
  ApplicationCoverageDtoSchema,
  ApplicationTranscriptDtoSchema,
  GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
  GATEQ_APPLY_CONTACT_CONFIRM_PATH,
  GATEQ_APPLY_CONTACT_PATH,
  GATEQ_APPLY_COVERAGE_PATH,
  GATEQ_APPLY_INTERVIEW_OPEN_PATH,
  GATEQ_APPLY_TRANSCRIPT_PATH,
  type ApplicationContactRequest,
  ApplicationTurnResponseSchema,
  ApplicationAnswersResponseSchema,
  GATEQ_APPLY_ANSWERS_PATH,
  GATEQ_APPLY_MATERIALS_PATH,
  ShareApplicationMaterialsResponseSchema,
  type ApplicationAnswersRequest,
  GATEQ_APPLY_START_PATH,
  GATEQ_APPLY_SUBMIT_PATH,
  GATEQ_APPLY_TURN_PATH,
  GATEQ_GATEWAYS_PATH,
  gateqGatewayApplicationsPath,
  GatewayApplicationListDtoSchema,
  GATEQ_GATEWAY_PATH,
  GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH,
  GatewayDtoSchema,
  GatewayPolicyDtoSchema,
  GatewayVersionDtoSchema,
  PolicyExtractionDtoSchema,
  type PolicyExtractionRequest,
  PublicGatewayDtoSchema,
  StartApplicationResponseSchema,
  SubmitApplicationResponseSchema,
  type GatewayDraftRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * GateQ (CQ-GATE-001/002). Configuration calls run as a member of the
 * investor organisation; the public gateway read and the applicant calls
 * are anonymous, carrying only the application's own session token.
 */

const GatewayListSchema = z
  .object({ gateways: z.array(GatewayDtoSchema) })
  .strict();

const path = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (built, [key, value]) =>
      built.replace(`:${key}`, encodeURIComponent(value)),
    template,
  );

export function listGateways(
  session: ApiSession,
  investorOrganisationId: string,
) {
  return call(
    session,
    "GET",
    `${GATEQ_GATEWAYS_PATH}?investorOrganisationId=${encodeURIComponent(investorOrganisationId)}`,
    GatewayListSchema,
  );
}

export function createGateway(
  session: ApiSession,
  input: { readonly investorOrganisationId: string; readonly name: string },
) {
  return call(session, "POST", GATEQ_GATEWAYS_PATH, GatewayDtoSchema, {
    body: input,
  });
}

export function draftGatewayVersion(
  session: ApiSession,
  gatewayId: string,
  draft: GatewayDraftRequest,
) {
  return call(
    session,
    "POST",
    path("/v1/gateq/gateways/:gatewayId/versions", { gatewayId }),
    GatewayVersionDtoSchema,
    { body: draft },
  );
}

export function publishGatewayVersion(
  session: ApiSession,
  gatewayId: string,
  versionId: string,
) {
  return call(
    session,
    "POST",
    path("/v1/gateq/gateways/:gatewayId/versions/:versionId/publish", {
      gatewayId,
      versionId,
    }),
    GatewayVersionDtoSchema,
  );
}

export function listGatewayApplications(
  session: ApiSession,
  gatewayId: string,
) {
  return call(
    session,
    "GET",
    gateqGatewayApplicationsPath(gatewayId),
    GatewayApplicationListDtoSchema,
  );
}

/** Anonymous: a published gateway's public wording. */
export function getPublicGateway(baseUrl: string, publicId: string) {
  return call(
    { baseUrl, accessToken: "" },
    "GET",
    path("/v1/gateq/public/:publicId", { publicId }),
    PublicGatewayDtoSchema,
  );
}

/** Anonymous: starts an application; the reply carries its session token. */
export function startApplication(
  baseUrl: string,
  gatewayPublicId: string,
  mode?: "conversation" | "form",
) {
  return call(
    { baseUrl, accessToken: "" },
    "POST",
    GATEQ_APPLY_START_PATH,
    StartApplicationResponseSchema,
    {
      body:
        mode === undefined ? { gatewayPublicId } : { gatewayPublicId, mode },
    },
  );
}

/** F1: the GateQ form's answers; the engine's answer comes back. */
export function saveApplicationAnswers(
  baseUrl: string,
  sessionToken: string,
  answers: ApplicationAnswersRequest,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_ANSWERS_PATH,
    ApplicationAnswersResponseSchema,
    { body: answers },
  );
}

export function applicationTurn(
  baseUrl: string,
  sessionToken: string,
  input: { readonly message: string; readonly clientTurnId: string },
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_TURN_PATH,
    ApplicationTurnResponseSchema,
    { body: input },
  );
}

export function submitApplication(
  baseUrl: string,
  sessionToken: string,
  clientRequestId: string,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_SUBMIT_PATH,
    SubmitApplicationResponseSchema,
    { body: { clientRequestId } },
  );
}

/** The gateway's current published (or latest) policy, for its own members. */
export function getGatewayPolicy(session: ApiSession, gatewayId: string) {
  return call(
    session,
    "GET",
    path(GATEQ_GATEWAY_PATH, { gatewayId }),
    GatewayPolicyDtoSchema,
  );
}

/**
 * P7: read the investor's mandate into DRAFT criteria. Idempotent on the
 * request's own `clientRequestId`; nothing is published.
 */
export function extractGatewayPolicy(
  session: ApiSession,
  gatewayId: string,
  input: PolicyExtractionRequest,
) {
  return call(
    session,
    "POST",
    path(GATEQ_GATEWAY_POLICY_EXTRACTIONS_PATH, { gatewayId }),
    PolicyExtractionDtoSchema,
    { body: input },
  );
}

/** F1: a signed-in founder shares their own documents with an application. */
export function shareApplicationMaterials(
  session: ApiSession,
  input: {
    readonly sessionToken: string;
    readonly documentIds: readonly string[];
  },
) {
  return call(
    session,
    "POST",
    GATEQ_APPLY_MATERIALS_PATH,
    ShareApplicationMaterialsResponseSchema,
    { body: input },
  );
}

// ---------------------------------------------------------------------------
// GateQ slice 1: contact first, the durable transcript and the coverage check.
// ---------------------------------------------------------------------------

/** Anonymous: saves the applicant's contact and emails a six-digit code. */
export function saveApplicationContact(
  baseUrl: string,
  sessionToken: string,
  contact: ApplicationContactRequest,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_CONTACT_PATH,
    ApplicationContactResponseSchema,
    { body: contact },
  );
}

/** Anonymous: the code from that email. A wrong code is a status, not an error. */
export function confirmApplicationContact(
  baseUrl: string,
  sessionToken: string,
  code: string,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_CONTACT_CONFIRM_PATH,
    ApplicationContactConfirmResponseSchema,
    { body: { code } },
  );
}

/**
 * A signed-in founder's contact. The account's own email, resolved by the
 * server from the actor (never this body), confirms a matching address
 * without a code; the guest credential travels in the body.
 */
export function saveAccountApplicationContact(
  session: ApiSession,
  input: ApplicationContactRequest & { readonly sessionToken: string },
) {
  return call(
    session,
    "POST",
    GATEQ_APPLY_CONTACT_ACCOUNT_PATH,
    ApplicationContactResponseSchema,
    { body: input },
  );
}

/** Anonymous: the interview so far, both sides, in order. */
export function getApplicationTranscript(
  baseUrl: string,
  sessionToken: string,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "GET",
    GATEQ_APPLY_TRANSCRIPT_PATH,
    ApplicationTranscriptDtoSchema,
  );
}

/**
 * Anonymous: opens the interview. Q asks the first question when nothing
 * has been said yet; otherwise this is the transcript, with no model call.
 */
export function openApplicationInterview(
  baseUrl: string,
  sessionToken: string,
) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "POST",
    GATEQ_APPLY_INTERVIEW_OPEN_PATH,
    ApplicationTranscriptDtoSchema,
  );
}

/** Anonymous: the deterministic completeness check before Submit. */
export function getApplicationCoverage(baseUrl: string, sessionToken: string) {
  return call(
    { baseUrl, accessToken: sessionToken },
    "GET",
    GATEQ_APPLY_COVERAGE_PATH,
    ApplicationCoverageDtoSchema,
  );
}
