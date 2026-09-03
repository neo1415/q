import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CapitalObjectiveIdSchema,
  toCapitalObjectiveDto,
  type CapitalObjectiveId,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema, type CompanyId } from "@capital-q/companies";
import {
  CAPITAL_OBJECTIVE_CLOSE_SUFFIX,
  CAPITAL_OBJECTIVE_CURRENT_SEGMENT,
  CAPITAL_OBJECTIVE_REPLACE_SUFFIX,
  CAPITAL_OBJECTIVES_SUFFIX,
  CapitalObjectiveDtoSchema,
  CloseCapitalObjectiveRequestSchema,
  COMPANIES_PATH,
  CorrelationIdSchema,
  CreateCapitalObjectiveRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ListCapitalObjectivesQuerySchema,
  ListCapitalObjectivesResponseSchema,
  parseContract,
  ReplaceCapitalObjectiveRequestSchema,
  UpdateCapitalObjectiveRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";

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

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

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

  app.post(base, { onRequest: withContext }, async (request, reply) => {
    const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    const idempotencyKey = parseContract(
      IdempotencyKeyHeaderSchema,
      typeof rawKey === "string" ? rawKey : undefined,
      "An Idempotency-Key header is required to create a capital objective.",
    );
    const input = parseContract(
      CreateCapitalObjectiveRequestSchema,
      request.body,
      "The capital objective request is not valid.",
    );
    const companyId = companyIdParam(request);
    const objective = await service.createCapitalObjective({
      actor: getActorContext(request),
      companyId,
      input,
      idempotencyKey,
      correlationId: correlation(),
    });
    void reply
      .status(201)
      .header(
        "Location",
        `${COMPANIES_PATH}/${companyId}${CAPITAL_OBJECTIVES_SUFFIX}/${objective.id}`,
      )
      .header("Cache-Control", "no-store");
    return CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));
  });

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

  app.patch(byId, { onRequest: withContext }, async (request, reply) => {
    const input = parseContract(
      UpdateCapitalObjectiveRequestSchema,
      request.body,
      "The capital objective update is not valid.",
    );
    const objective = await service.updateCapitalObjective({
      actor: getActorContext(request),
      companyId: companyIdParam(request),
      capitalObjectiveId: objectiveIdParam(request),
      input,
      correlationId: correlation(),
    });
    void reply.header("Cache-Control", "no-store");
    return CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));
  });

  app.post(
    `${byId}${CAPITAL_OBJECTIVE_CLOSE_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        CloseCapitalObjectiveRequestSchema,
        request.body,
        "The close request is not valid.",
      );
      const objective = await service.closeCapitalObjective({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
        capitalObjectiveId: objectiveIdParam(request),
        input,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));
    },
  );

  app.post(
    `${byId}${CAPITAL_OBJECTIVE_REPLACE_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        ReplaceCapitalObjectiveRequestSchema,
        request.body,
        "The replace request is not valid.",
      );
      const companyId = companyIdParam(request);
      const { replacement } = await service.replaceCapitalObjective({
        actor: getActorContext(request),
        companyId,
        capitalObjectiveId: objectiveIdParam(request),
        input,
        correlationId: correlation(),
      });
      void reply
        .status(201)
        .header(
          "Location",
          `${COMPANIES_PATH}/${companyId}${CAPITAL_OBJECTIVES_SUFFIX}/${replacement.id}`,
        )
        .header("Cache-Control", "no-store");
      return CapitalObjectiveDtoSchema.parse(
        toCapitalObjectiveDto(replacement),
      );
    },
  );
}
