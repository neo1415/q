import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  AudiencePreviewDtoSchema,
  AudiencePreviewQuerySchema,
  COMPANY_AUDIENCE_PREVIEW_PATH,
  COMPANY_VISIBILITY_STATE_PATH,
  parseContract,
  VisibilityStateDtoSchema,
} from "@capital-q/contracts";
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
}
