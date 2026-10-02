import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  COMPANIES_PATH,
  COMPANY_VERIFICATION_SEGMENT,
  CompanyVerificationDtoSchema,
  parseContract,
  UuidSchema,
} from "@capital-q/contracts";
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
}
