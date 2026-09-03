import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  InvestorOrganisationIdSchema,
  toInvestorOrganisationDto,
  toInvestorRepresentativeDto,
  type InvestorOrganisationId,
  type InvestorService,
} from "@capital-q/investors";
import {
  CorrelationIdSchema,
  CreateInvestorOrganisationRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  INVESTOR_REPRESENTATIVE_ME_SUFFIX,
  INVESTORS_CURRENT_PATH,
  INVESTORS_PATH,
  InvestorOrganisationDtoSchema,
  InvestorRepresentativeDtoSchema,
  parseContract,
  UpdateInvestorOrganisationRequestSchema,
  UpsertMyInvestorRepresentativeRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/investors` -- "investor" is the canonical InvestorOrganisation
 * resource. Every operation is organisation-scoped: the actor-context hook
 * resolves tenant, organisation and membership from trusted rows and fails
 * closed (CONTEXT_REQUIRED) when a person has no active organisation. The
 * `/representatives/me` routes are about the caller only: no path or body
 * parameter names a person. Handlers parse the contract, call the service
 * and map the DTO -- no investor rule lives here.
 */

export type InvestorRoutesDependencies = ActorContextDependencies & {
  readonly investors: InvestorService;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function investorIdParam(request: FastifyRequest): InvestorOrganisationId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    InvestorOrganisationIdSchema,
    params["investorOrganisationId"],
    "The investor organisation identifier is not valid.",
  );
}

export function registerInvestorRoutes(
  app: FastifyInstance,
  dependencies: InvestorRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.investors;
  const byId = `${INVESTORS_PATH}/:investorOrganisationId`;

  app.post(
    INVESTORS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to create an investor organisation.",
      );
      const input = parseContract(
        CreateInvestorOrganisationRequestSchema,
        request.body,
        "The investor organisation request is not valid.",
      );

      const investor = await service.createInvestorOrganisation({
        actor,
        input,
        idempotencyKey,
        correlationId: correlation(),
      });

      void reply
        .status(201)
        .header("Location", `${INVESTORS_PATH}/${investor.id}`)
        .header("Cache-Control", "no-store");
      return InvestorOrganisationDtoSchema.parse(
        toInvestorOrganisationDto(investor),
      );
    },
  );

  // Static segment: registered alongside the parameterised route; the router
  // prefers the literal match, and "current" is not a valid UUID anyway.
  app.get(
    INVESTORS_CURRENT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const investor = await service.getCurrentInvestorOrganisation({
        actor: getActorContext(request),
      });
      void reply.header("Cache-Control", "no-store");
      return InvestorOrganisationDtoSchema.parse(
        toInvestorOrganisationDto(investor),
      );
    },
  );

  app.get(byId, { onRequest: withContext }, async (request, reply) => {
    const investor = await service.getInvestorOrganisation({
      actor: getActorContext(request),
      investorOrganisationId: investorIdParam(request),
    });
    void reply.header("Cache-Control", "no-store");
    return InvestorOrganisationDtoSchema.parse(
      toInvestorOrganisationDto(investor),
    );
  });

  app.patch(byId, { onRequest: withContext }, async (request, reply) => {
    const input = parseContract(
      UpdateInvestorOrganisationRequestSchema,
      request.body,
      "The investor organisation update is not valid.",
    );
    const investor = await service.updateInvestorOrganisation({
      actor: getActorContext(request),
      investorOrganisationId: investorIdParam(request),
      input,
      correlationId: correlation(),
    });
    void reply.header("Cache-Control", "no-store");
    return InvestorOrganisationDtoSchema.parse(
      toInvestorOrganisationDto(investor),
    );
  });

  app.get(
    `${byId}${INVESTOR_REPRESENTATIVE_ME_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const representative = await service.getMyInvestorRepresentative({
        actor: getActorContext(request),
        investorOrganisationId: investorIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return InvestorRepresentativeDtoSchema.parse(
        toInvestorRepresentativeDto(representative),
      );
    },
  );

  app.put(
    `${byId}${INVESTOR_REPRESENTATIVE_ME_SUFFIX}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        UpsertMyInvestorRepresentativeRequestSchema,
        request.body,
        "The representation request is not valid.",
      );
      const representative = await service.upsertMyInvestorRepresentative({
        actor: getActorContext(request),
        investorOrganisationId: investorIdParam(request),
        input,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return InvestorRepresentativeDtoSchema.parse(
        toInvestorRepresentativeDto(representative),
      );
    },
  );
}
