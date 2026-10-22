import type { FastifyInstance } from "fastify";

import {
  ActivityPageDtoSchema,
  ME_CAPABILITIES_PATH,
  MeCapabilitiesDtoSchema,
  MemberSummaryDtoSchema,
  ORGANISATION_ACTIVITY_PATH,
  ORGANISATION_MEMBER_SUMMARY_PATH,
} from "@capital-q/contracts";
import type { OrganisationAdminService } from "@capital-q/organisations";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Organisation administration reads.
 *
 * - GET /v1/me/capabilities: the caller's effective capabilities in their
 *   ACTIVE organisation, from server-side policy facts, with the team role
 *   and abilities read from the same facts. The web gates every control on
 *   this; the server still enforces each action itself.
 * - GET /v1/organisation/activity: the active organisation's activity feed
 *   (organisation.activity.view). The organisation is never a parameter.
 * - GET /v1/organisation/members/:userId/summary: one member, for admins.
 *
 * Denials are the shared problem details (403 PERMISSION_DENIED); a person
 * outside the organisation is the one enumeration-safe 404.
 */
export type OrganisationAdminRoutesDependencies = ActorContextDependencies & {
  readonly organisationAdmin: OrganisationAdminService;
};

export function registerOrganisationAdminRoutes(
  app: FastifyInstance,
  dependencies: OrganisationAdminRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { organisationAdmin } = dependencies;

  app.get(
    ME_CAPABILITIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const out = await organisationAdmin.myCapabilities(
        getActorContext(request),
      );
      void reply.header("Cache-Control", "no-store");
      return MeCapabilitiesDtoSchema.parse(out);
    },
  );

  app.get(
    ORGANISATION_ACTIVITY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const out = await organisationAdmin.activity(
        getActorContext(request),
        request.query,
      );
      void reply.header("Cache-Control", "no-store");
      return ActivityPageDtoSchema.parse(out);
    },
  );

  app.get<{ Params: { userId: string } }>(
    ORGANISATION_MEMBER_SUMMARY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const out = await organisationAdmin.memberSummary(
        getActorContext(request),
        request.params.userId,
      );
      void reply.header("Cache-Control", "no-store");
      return MemberSummaryDtoSchema.parse(out);
    },
  );
}
