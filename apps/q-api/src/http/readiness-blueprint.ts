import type { FastifyInstance } from "fastify";
import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_READINESS_BLUEPRINTS_PATH,
  ReadinessBlueprintRequestSchema,
} from "@capital-q/contracts";
import {
  billingAccountOf,
  FEATURE_READINESS_BLUEPRINT,
  type EntitlementService,
} from "@capital-q/billing";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { sendEntitlementRequired } from "./entitlement-problem.js";

/**
 * The Capital Readiness Blueprint (PADL #85 Layer 2 "Pro"; ADR 0036):
 * the route exists so the plan boundary and the contract are fixed before
 * the feature is built. It reads nothing and calls no model. A person
 * whose plan does not include it learns that (ENTITLEMENT_REQUIRED); a
 * person whose plan does learns plainly that it is not built yet (501).
 * When it is built, the company is checked to be the actor's own before
 * anything is read.
 */

export type ReadinessBlueprintRoutesDependencies = ActorContextDependencies & {
  readonly entitlements: Pick<EntitlementService, "check">;
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
      const decision = await dependencies.entitlements.check(
        billingAccountOf(getActorContext(request)),
        FEATURE_READINESS_BLUEPRINT,
      );
      if (!decision.allowed) {
        return sendEntitlementRequired(request, reply, decision.refusal);
      }
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
    },
  );
}
