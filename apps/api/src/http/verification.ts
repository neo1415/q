import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  COMPANIES_PATH,
  COMPANY_VERIFICATION_REQUESTS_SEGMENT,
  COMPANY_VERIFICATION_SEGMENT,
  CompanyVerificationDtoSchema,
  CorrelationIdSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  RequestCompanyVerificationRequestSchema,
  UuidSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import { createCorrelationId } from "@capital-q/observability";
import type { CompanyVerificationService } from "@capital-q/verification";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies/:companyId/verification` (CQ-VERIFY-001).
 *
 * A founder reads where verification stands and asks Capital Q to verify.
 * Nothing a client sends can name a standing, a method or a decision: the
 * request body must be empty, and the path names only the company, which
 * the service resolves inside the actor's own organisation. No route here
 * decides anything; deciding belongs to Capital Q's worker.
 */

export type VerificationRoutesDependencies = ActorContextDependencies & {
  readonly verification: CompanyVerificationService;
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function companyIdParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    UuidSchema,
    params["companyId"],
    "The company identifier is not valid.",
  );
}

export function registerVerificationRoutes(
  app: FastifyInstance,
  dependencies: VerificationRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.verification;
  const base = `${COMPANIES_PATH}/:companyId`;

  app.get(
    `${base}${COMPANY_VERIFICATION_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const verification = await service.getCompanyVerification({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyVerificationDtoSchema.parse(verification);
    },
  );

  app.post(
    `${base}${COMPANY_VERIFICATION_REQUESTS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to request verification.",
      );
      // Strict and empty: a body that tries to choose anything is refused
      // rather than ignored, so no client believes it set a standing.
      parseContract(
        RequestCompanyVerificationRequestSchema,
        request.body ?? {},
        "A verification request carries no body.",
      );
      const result = await service.requestCompanyVerification({
        actor,
        companyId: companyIdParam(request),
        idempotencyKey,
        correlationId: correlation(),
      });
      void reply
        .status(result.requested.length === 0 ? 200 : 202)
        .header("Cache-Control", "no-store");
      return CompanyVerificationDtoSchema.parse(result.verification);
    },
  );
}
