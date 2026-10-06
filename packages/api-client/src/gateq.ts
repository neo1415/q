import { z } from "zod";

import {
  ApplicationTurnResponseSchema,
  ApplicationAnswersResponseSchema,
  GATEQ_APPLY_ANSWERS_PATH,
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
    { body: mode === undefined ? { gatewayPublicId } : { gatewayPublicId, mode } },
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
