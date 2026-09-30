import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_STANDING_PATH,
  Q_STANDING_PERSONALITY_PATH,
  QStandingDtoSchema,
  SetQPersonalityRequestSchema,
} from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
  requireActorContextOrPersonalHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import type { QVoiceRoutesDependencies } from "../voice/routes.js";
import type { StandingStore } from "../voice/standing.js";

/**
 * The person's own standing with Q (founder direction 2026-09-30): which
 * personality they chose for Q, and whether Q paused their account. Their
 * own row only, by the resolved actor; nothing here takes a user id.
 * A person mid-onboarding has no organisation yet, so the personal
 * bootstrap context is accepted, as for the interview itself.
 */
export type StandingRoutesDependencies = ActorContextDependencies & {
  readonly identity?: QVoiceRoutesDependencies["identity"] | undefined;
  readonly standing: StandingStore;
};

export function registerStandingRoutes(
  app: FastifyInstance,
  dependencies: StandingRoutesDependencies,
): void {
  const identity = dependencies.identity;
  const withContext =
    identity === undefined
      ? requireActorContextHook(dependencies)
      : requireActorContextOrPersonalHook({ ...dependencies, identity });
  const { standing } = dependencies;

  app.get(
    Q_STANDING_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const mine = await standing.read(
        actor.userId,
        actor.tenantId,
        new Date(),
      );
      void reply.header("Cache-Control", "no-store");
      return QStandingDtoSchema.parse({
        personality: mine.personality,
        paused: mine.conduct.suspended,
      });
    },
  );

  app.put(
    Q_STANDING_PERSONALITY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = SetQPersonalityRequestSchema.safeParse(request.body);
      if (!body.success) {
        const problem = createProblemDetails({
          code: "INVALID_REQUEST",
          requestId: request.id,
          detail: "Choose one of Q's personalities.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const actor = getActorContext(request);
      await standing.setPersonality(
        actor.userId,
        actor.tenantId,
        body.data.personality,
      );
      const mine = await standing.read(
        actor.userId,
        actor.tenantId,
        new Date(),
      );
      void reply.header("Cache-Control", "no-store");
      return QStandingDtoSchema.parse({
        personality: mine.personality,
        paused: mine.conduct.suspended,
      });
    },
  );
}
