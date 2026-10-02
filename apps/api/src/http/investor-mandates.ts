import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  toInvestorMandateDto,
  toInvestorMandateSummaryDto,
  type InvestorMandateId,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
  INVESTOR_MANDATES_SUFFIX,
  INVESTORS_PATH,
  InvestorMandateDtoSchema,
  ListInvestorMandatesQuerySchema,
  ListInvestorMandatesResponseSchema,
  parseContract,
} from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
} from "../security/actor-context.js";
import type { InvestorRoutesDependencies } from "./investors.js";

/**
 * `/v1/investors/:investorOrganisationId/mandates`. Organisation-scoped
 * through the actor-context hook; the investor organisation and the mandate
 * both come from the path and are resolved under the caller's tenant and
 * active organisation by the service. Handlers parse the contract, call the
 * service and map the organisation-internal DTO. No mandate rule lives here,
 * no delete route exists, and nothing is ranked.
 */

function investorIdParam(request: FastifyRequest): InvestorOrganisationId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    InvestorOrganisationIdSchema,
    params["investorOrganisationId"],
    "The investor organisation identifier is not valid.",
  );
}

function mandateIdParam(request: FastifyRequest): InvestorMandateId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    InvestorMandateIdSchema,
    params["mandateId"],
    "The mandate identifier is not valid.",
  );
}

export function registerInvestorMandateRoutes(
  app: FastifyInstance,
  dependencies: InvestorRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.investors;
  const base = `${INVESTORS_PATH}/:investorOrganisationId${INVESTOR_MANDATES_SUFFIX}`;
  const byId = `${base}/:mandateId`;

  app.get(base, { onRequest: withContext }, async (request, reply) => {
    const query = parseContract(
      ListInvestorMandatesQuerySchema,
      request.query,
      "The list query is not valid.",
    );
    const page = await service.listInvestorMandates({
      actor: getActorContext(request),
      investorOrganisationId: investorIdParam(request),
      status: query.status,
      cursor: query.cursor,
      limit: query.limit,
    });
    void reply.header("Cache-Control", "no-store");
    return ListInvestorMandatesResponseSchema.parse({
      items: page.items.map(toInvestorMandateSummaryDto),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  });

  app.get(byId, { onRequest: withContext }, async (request, reply) => {
    const mandate = await service.getInvestorMandate({
      actor: getActorContext(request),
      investorOrganisationId: investorIdParam(request),
      mandateId: mandateIdParam(request),
    });
    void reply.header("Cache-Control", "no-store");
    return InvestorMandateDtoSchema.parse(toInvestorMandateDto(mandate));
  });
}
