import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  AudiencePreviewDtoSchema,
  AudiencePreviewQuerySchema,
  COMPANY_AUDIENCE_PREVIEW_PATH,
  COMPANY_SHARE_REVOKE_PATH,
  COMPANY_SHARES_PATH,
  COMPANY_VISIBILITY_STATE_PATH,
  CorrelationIdSchema,
  CreateVisibilityShareRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  VisibilityRevokeResultDtoSchema,
  VisibilityShareResultDtoSchema,
  VisibilityStateDtoSchema,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type { VisibilityCentre } from "@capital-q/permissions";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies/:companyId/visibility/…` — the visibility control centre
 * (CQ-BIZ-003).
 *
 * The company id is input; the permissions context decides whether the
 * caller is of the company's own organisation with disclosure.inspect
 * (and disclosure.manage to share or revoke). Anyone else, and any company
 * that does not exist, is the same 404. The preview is read-only; nothing
 * here impersonates the audience it describes.
 */

export type VisibilityRoutesDependencies = ActorContextDependencies & {
  readonly visibility: VisibilityCentre;
};

function param(request: FastifyRequest, name: string): string {
  const raw = (request.params as Record<string, unknown>)[name];
  return typeof raw === "string" ? raw : "";
}

function requireIdempotencyKey(request: FastifyRequest): void {
  // A share is consequential; retries of it are collapsed by the policy
  // manager's own duplicate rule, and the key is required so a client
  // cannot omit the retry contract.
  const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
  parseContract(
    IdempotencyKeyHeaderSchema,
    typeof rawKey === "string" ? rawKey : undefined,
    "An Idempotency-Key header is required to share.",
  );
}

export function registerVisibilityRoutes(
  app: FastifyInstance,
  dependencies: VisibilityRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const centre = dependencies.visibility;

  app.get(
    COMPANY_VISIBILITY_STATE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const state = await centre.state({
        actor: getActorContext(request),
        companyId: param(request, "companyId"),
      });
      void reply.header("Cache-Control", "no-store");
      return VisibilityStateDtoSchema.parse(state);
    },
  );

  app.get(
    COMPANY_AUDIENCE_PREVIEW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = parseContract(
        AudiencePreviewQuerySchema,
        request.query,
        "Choose an audience to preview.",
      );
      const preview = await centre.preview({
        actor: getActorContext(request),
        companyId: param(request, "companyId"),
        audience: query.audience,
        relationshipId: query.relationshipId,
      });
      void reply.header("Cache-Control", "no-store");
      return AudiencePreviewDtoSchema.parse(preview);
    },
  );

  app.post(
    COMPANY_SHARES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      requireIdempotencyKey(request);
      const input = parseContract(
        CreateVisibilityShareRequestSchema,
        request.body,
        "The share request is not valid.",
      );
      const result = await centre.share({
        actor: getActorContext(request),
        companyId: param(request, "companyId"),
        object: input.object,
        relationshipId: input.relationshipId,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });
      void reply
        .status(result.outcome === "CREATED" ? 201 : 200)
        .header("Cache-Control", "no-store");
      return VisibilityShareResultDtoSchema.parse(result);
    },
  );

  app.post(
    COMPANY_SHARE_REVOKE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const result = await centre.revoke({
        actor: getActorContext(request),
        companyId: param(request, "companyId"),
        policyId: param(request, "policyId"),
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });
      void reply.header("Cache-Control", "no-store");
      return VisibilityRevokeResultDtoSchema.parse(result);
    },
  );
}
