import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CompanyIdSchema,
  toCompanyMemberDto,
  toCompanyTeamFactsDto,
  toFounderProfileDto,
  type CompanyId,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  COMPANY_FOUNDER_PROFILE_ME_SUFFIX,
  COMPANY_TEAM_FACTS_SUFFIX,
  COMPANY_TEAM_ME_SUFFIX,
  CompanyMemberDtoSchema,
  CompanyTeamFactsDtoSchema,
  FounderProfileDtoSchema,
  parseContract,
} from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
} from "../security/actor-context.js";
import type { CompanyRoutesDependencies } from "./companies.js";

/**
 * `/v1/companies/:companyId/team/me`, `/founder-profile/me`, `/team-facts`.
 *
 * All organisation-scoped through the actor-context hook. The `/me` routes
 * are about the caller only: there is no path or body parameter naming a
 * person, so a client cannot read or write anyone else's relationship or
 * profile. Handlers parse, call the service and map the DTO.
 */

function companyIdParam(request: FastifyRequest): CompanyId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    CompanyIdSchema,
    params["companyId"],
    "The company identifier is not valid.",
  );
}

export function registerCompanyTeamRoutes(
  app: FastifyInstance,
  dependencies: CompanyRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.companies;
  const base = `${COMPANIES_PATH}/:companyId`;

  app.get(
    `${base}${COMPANY_TEAM_ME_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const member = await service.getMyCompanyMembership({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyMemberDtoSchema.parse(toCompanyMemberDto(member));
    },
  );

  // Declared in the app's action registry (ADR 0040); the route is
  // generated (http/app-actions.ts), as Q's path is.

  app.get(
    `${base}${COMPANY_FOUNDER_PROFILE_ME_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const profile = await service.getMyFounderProfile({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return FounderProfileDtoSchema.parse(toFounderProfileDto(profile));
    },
  );

  // Declared in the app's action registry (ADR 0040); the route is
  // generated (http/app-actions.ts), as Q's path is.

  app.get(
    `${base}${COMPANY_TEAM_FACTS_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const facts = await service.getCompanyTeamFacts({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyTeamFactsDtoSchema.parse(toCompanyTeamFactsDto(facts));
    },
  );

  // Declared in the app's action registry (ADR 0040); the route is
  // generated (http/app-actions.ts), as Q's path is.
}
