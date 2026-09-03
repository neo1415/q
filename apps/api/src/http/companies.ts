import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CompanyIdSchema,
  toCompanyDto,
  type CompanyId,
  type CompanyService,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  CompanyDtoSchema,
  CorrelationIdSchema,
  CreateCompanyRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  UpdateCompanyRequestSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies`. Every operation is organisation-scoped: the actor-context
 * hook resolves tenant, organisation and membership from trusted rows and
 * fails closed (CONTEXT_REQUIRED) when a person has no active organisation.
 * Handlers parse the contract, call the service and map the DTO -- no
 * company rule lives here.
 */

export type CompanyRoutesDependencies = ActorContextDependencies & {
  readonly companies: CompanyService;
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

export function registerCompanyRoutes(
  app: FastifyInstance,
  dependencies: CompanyRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.companies;

  app.post(
    COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to create a company.",
      );
      const input = parseContract(
        CreateCompanyRequestSchema,
        request.body,
        "The company request is not valid.",
      );

      const company = await service.createCompany({
        actor,
        input,
        idempotencyKey,
        correlationId: correlation(),
      });

      void reply
        .status(201)
        .header("Location", `${COMPANIES_PATH}/${company.id}`)
        .header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse(toCompanyDto(company));
    },
  );

  app.get(
    `${COMPANIES_PATH}/:companyId`,
    { onRequest: withContext },
    async (request, reply) => {
      const company = await service.getCompany({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse(toCompanyDto(company));
    },
  );

  app.patch(
    `${COMPANIES_PATH}/:companyId`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        UpdateCompanyRequestSchema,
        request.body,
        "The company update is not valid.",
      );
      const company = await service.updateCompany({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
        input,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse(toCompanyDto(company));
    },
  );
}
