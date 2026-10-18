import type { FastifyInstance } from "fastify";
import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_READINESS_BLUEPRINTS_PATH,
  ReadinessBlueprintDtoSchema,
  ReadinessBlueprintRequestSchema,
  type ReadinessBlueprintDto,
} from "@capital-q/contracts";
import {
  billingAccountOf,
  FEATURE_READINESS_BLUEPRINT,
  type EntitlementService,
} from "@capital-q/billing";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { sendEntitlementRequired } from "./entitlement-problem.js";

/**
 * The Capital Readiness Blueprint (PADL #85 Layer 2 "Pro"; ADR 0036).
 *
 * The plan gate comes first: a person whose plan does not include it
 * learns that (ENTITLEMENT_REQUIRED). Then the company is checked to be
 * the actor's own before anything is read (a company that is not theirs,
 * or an investor, gets the same 404). The Blueprint v1 is built by code
 * from the free diagnosis (@capital-q/readiness): its open actions,
 * sequenced over the horizon, each naming the gap it closes. No model is
 * called. Without a generator composed the route still answers 501, so a
 * build without it never shows placeholder work.
 */

export type ReadinessBlueprintRoutesDependencies = ActorContextDependencies & {
  readonly entitlements: Pick<EntitlementService, "check">;
  readonly blueprints?:
    | {
        readonly blueprint: (
          actor: ActorContext,
          companyId: string,
          horizonMonths: 3 | 6 | 12,
        ) => Promise<ReadinessBlueprintDto | null>;
      }
    | undefined;
};

export const BLUEPRINT_NOT_BUILT =
  "The Capital Readiness Blueprint isn't available yet. Q's diagnosis of your company is free and ready now: ask Q how investors will see you.";

export function registerReadinessBlueprintRoutes(
  app: FastifyInstance,
  dependencies: ReadinessBlueprintRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.post(
    Q_READINESS_BLUEPRINTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = ReadinessBlueprintRequestSchema.safeParse(request.body);
      if (!body.success) {
        const problem = createProblemDetails({
          code: "INVALID_REQUEST",
          requestId: request.id,
          detail: "Invalid request.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send(problem);
      }
      const actor = getActorContext(request);
      const decision = await dependencies.entitlements.check(
        billingAccountOf(actor),
        FEATURE_READINESS_BLUEPRINT,
      );
      if (!decision.allowed) {
        return sendEntitlementRequired(request, reply, decision.refusal);
      }
      if (dependencies.blueprints === undefined) {
        const problem = createProblemDetails({
          code: "NOT_IMPLEMENTED",
          requestId: request.id,
          detail: BLUEPRINT_NOT_BUILT,
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send(problem);
      }
      const blueprint = await dependencies.blueprints.blueprint(
        actor,
        body.data.companyId,
        body.data.horizonMonths,
      );
      if (blueprint === null) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
          detail: "Not found.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .header("Cache-Control", "no-store")
          .send(problem);
      }
      void reply.header("Cache-Control", "no-store");
      return ReadinessBlueprintDtoSchema.parse(blueprint);
    },
  );
}
