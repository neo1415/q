import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CapitalObjectiveIdSchema,
  toCapitalObjectiveDto,
  type CapitalObjectiveId,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema, type CompanyId } from "@capital-q/companies";
import {
  CAPITAL_OBJECTIVE_CURRENT_SEGMENT,
  CAPITAL_OBJECTIVES_SUFFIX,
  CapitalObjectiveDtoSchema,
  COMPANIES_PATH,
  ListCapitalObjectivesQuerySchema,
  ListCapitalObjectivesResponseSchema,
  parseContract,
} from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies/:companyId/capital-objectives`. Organisation-scoped
 * through the actor-context hook; the company and the objective come from
 * the path and are resolved under the caller's tenant and active
 * organisation by the service. Handlers parse the contract, call the
 * service and map the organisation-internal DTO. No delete route, no
 * investor-facing route, nothing ranked.
 */

export type CapitalRoutesDependencies = ActorContextDependencies & {
  readonly capital: CapitalService;
};

function companyIdParam(request: FastifyRequest): CompanyId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    CompanyIdSchema,
    params["companyId"],
    "The company identifier is not valid.",
  );
}

function objectiveIdParam(request: FastifyRequest): CapitalObjectiveId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    CapitalObjectiveIdSchema,
    params["capitalObjectiveId"],
    "The capital objective identifier is not valid.",
  );
}

export function registerCapitalObjectiveRoutes(
  app: FastifyInstance,
  dependencies: CapitalRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.capital;
  const base = `${COMPANIES_PATH}/:companyId${CAPITAL_OBJECTIVES_SUFFIX}`;
  const byId = `${base}/:capitalObjectiveId`;

  app.get(base, { onRequest: withContext }, async (request, reply) => {
    const query = parseContract(
      ListCapitalObjectivesQuerySchema,
      request.query,
      "The list query is not valid.",
    );
    const page = await service.listCapitalObjectives({
      actor: getActorContext(request),
      companyId: companyIdParam(request),
      cursor: query.cursor,
      limit: query.limit,
    });
    void reply.header("Cache-Control", "no-store");
    return ListCapitalObjectivesResponseSchema.parse({
      items: page.items.map(toCapitalObjectiveDto),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  });

  // Static segment beside the parameterised route; the router prefers the
  // literal and "current" is not a valid UUID anyway.
  app.get(
    `${base}${CAPITAL_OBJECTIVE_CURRENT_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const objective = await service.getCurrentCapitalObjective({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));
    },
  );

  app.get(byId, { onRequest: withContext }, async (request, reply) => {
    const objective = await service.getCapitalObjective({
      actor: getActorContext(request),
      companyId: companyIdParam(request),
      capitalObjectiveId: objectiveIdParam(request),
    });
    void reply.header("Cache-Control", "no-store");
    return CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));
  });
}
