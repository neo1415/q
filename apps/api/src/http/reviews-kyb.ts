import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  HumanReviewListDtoSchema,
  KYB_PATH,
  KybDtoSchema,
  PROBLEM_CONTENT_TYPE,
  REVIEWS_PATH,
  type CorrelationId,
  type KnownErrorCode,
} from "@capital-q/contracts";
import type { PlatformAdmin } from "@capital-q/platform-admin";
import type { KybService } from "@capital-q/verification";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * ADMIN-3: a person asks for a human review (appeals Stage 4, PADL #050),
 * and an organisation submits its business details for verification
 * (manual KYB). Who asks is the server-resolved actor only; nothing in the
 * body names a tenant, an organisation or a person.
 */

export type ReviewsKybRoutesDependencies = ActorContextDependencies & {
  readonly reviews: Pick<PlatformAdmin, "requestReview" | "ownReviews">;
  readonly kyb: KybService;
  readonly newCorrelationId?: (() => CorrelationId) | undefined;
};

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  code: KnownErrorCode,
  detail: string,
) {
  const problem = createProblemDetails({ code, requestId: request.id, detail });
  return reply
    .status(problem.status)
    .type(PROBLEM_CONTENT_TYPE)
    .header("Cache-Control", "no-store")
    .send(problem);
}

export function registerReviewsKybRoutes(
  app: FastifyInstance,
  dependencies: ReviewsKybRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(REVIEWS_PATH, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    void reply.header("Cache-Control", "no-store");
    return HumanReviewListDtoSchema.parse({
      rows: await dependencies.reviews.ownReviews(actor.userId),
    });
  });

  app.get(KYB_PATH, { onRequest: withContext }, async (request, reply) => {
    const view = await dependencies.kyb.current(getActorContext(request));
    if (view === null) {
      return send(
        request,
        reply,
        "PERMISSION_DENIED",
        "Choose your organisation first.",
      );
    }
    void reply.header("Cache-Control", "no-store");
    return KybDtoSchema.parse(view);
  });
}
