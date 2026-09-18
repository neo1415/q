import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CompanyIdSchema,
  isNetworkVisible,
  projectCompanyForNetwork,
  toCompanyDto,
  type CompanyId,
  type CompanyService,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT,
  COMPANY_MARKETPLACE_READINESS_SEGMENT,
  COMPANY_NETWORK_PREVIEW_SEGMENT,
  COMPANY_VISIBILITY_SEGMENT,
  CompanyDtoSchema,
  CompanyNetworkPreviewSchema,
  MarketplaceReadinessAssessmentSchema,
  SetCompanyVisibilityRequestSchema,
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
  // Who may see the declared profile (CQ-PRE-REC-001 §31-§35). An
  // intentional act by an editor, never a side effect of onboarding.
  app.post(
    `${COMPANIES_PATH}/:companyId${COMPANY_VISIBILITY_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        SetCompanyVisibilityRequestSchema,
        request.body,
        "The visibility request is not valid.",
      );
      const company = await service.setCompanyVisibility({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
        input,
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse(toCompanyDto(company));
    },
  );

  // Marketplace readiness (CQ-MKT-001): what the policy says now, without
  // writing. The body-less POST asks for a reconciliation; there is no
  // field in which a client could name a state.
  app.get(
    `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const assessment = await service.getMarketplaceReadiness({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return MarketplaceReadinessAssessmentSchema.parse(assessment);
    },
  );

  app.post(
    `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const assessment = await service.assessMarketplaceReadiness({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return MarketplaceReadinessAssessmentSchema.parse(assessment);
    },
  );

  // "What investors will see": the same projection Q serves across the
  // network, built from the declared profile alone (§33). The founder's
  // own read of the company authorises it; nothing founder-private can be
  // in the result because the projection never reads it.
  app.get(
    `${COMPANIES_PATH}/:companyId${COMPANY_NETWORK_PREVIEW_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const company = await service.getCompany({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyNetworkPreviewSchema.parse({
        ...projectCompanyForNetwork(company),
        networkVisible: isNetworkVisible(company.marketplaceVisibility),
      });
    },
  );
}
