import { z } from "zod";

import {
  ApplicationTurnResponseSchema,
  GATEQ_APPLY_START_PATH,
  GATEQ_APPLY_SUBMIT_PATH,
  GATEQ_APPLY_TURN_PATH,
  GATEQ_GATEWAYS_PATH,
  gateqGatewayApplicationsPath,
  GatewayApplicationListDtoSchema,
  GatewayDtoSchema,
  GatewayVersionDtoSchema,
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
export function startApplication(baseUrl: string, gatewayPublicId: string) {
  return call(
    { baseUrl, accessToken: "" },
    "POST",
    GATEQ_APPLY_START_PATH,
    StartApplicationResponseSchema,
    { body: { gatewayPublicId } },
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
