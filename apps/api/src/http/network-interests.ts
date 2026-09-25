import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CompanyInterestStatusDtoSchema,
  CorrelationIdSchema,
  ExpressInterestRequestSchema,
  ExpressInterestResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
  NETWORK_COMPANY_INTEREST_PATH,
  parseContract,
} from "@capital-q/contracts";
import { toInterestDto, type InterestService } from "@capital-q/network";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/network/companies/:companyId/…` — Express Interest (CQ-NET-010).
 *
 * The one consequential command on the relationship spine, and it is
 * server-confirmed: the browser shows "sent" only after this answers.
 * Nothing on the request names an organisation, a tenant or a
 * relationship; the company id is input, and the service decides whether
 * this person, for their investor organisation, may act on it. A company
 * they may not see and one that does not exist are the same 404.
 *
 * Deliberately not here: Save and Pass (`/v1/discovery`, analytics of a
 * recommendation), a match or connection (CQ-NET-011), and any read of the
 * relationship's history.
 */

export type NetworkInterestRoutesDependencies = ActorContextDependencies & {
  readonly interests: InterestService;
};

function companyIdOf(request: FastifyRequest): string {
  // Validated as a canonical company id by the service; an invalid one is
  // the same not-found as an unknown one.
  const raw = (request.params as { companyId?: unknown }).companyId;
  return typeof raw === "string" ? raw : "";
}

export function registerNetworkInterestRoutes(
  app: FastifyInstance,
  dependencies: NetworkInterestRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.interests;

  app.post(
    NETWORK_COMPANY_EXPRESS_INTEREST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to express interest.",
      );
      const input = parseContract(
        ExpressInterestRequestSchema,
        request.body,
        "The interest request is not valid.",
      );

      const result = await service.expressInterest({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
        surface: input.surface,
        idempotencyKey,
        correlationId: CorrelationIdSchema.parse(createCorrelationId()),
      });

      void reply
        .status(result.deduplicated ? 200 : 201)
        .header("Cache-Control", "no-store");
      return ExpressInterestResultDtoSchema.parse({
        interest: toInterestDto(result.interest),
        deduplicated: result.deduplicated,
      });
    },
  );

  app.get(
    NETWORK_COMPANY_INTEREST_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const interest = await service.getOwnInterest({
        actor: getActorContext(request),
        companyId: companyIdOf(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyInterestStatusDtoSchema.parse({
        interest: interest === null ? null : toInterestDto(interest),
      });
    },
  );
}
