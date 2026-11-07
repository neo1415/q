import type { FastifyInstance } from "fastify";

import {
  COMPANY_ENGAGEMENT_PATH,
  CompanyEngagementDtoSchema,
  CompanyEngagementParamsSchema,
  CompanyEngagementQuerySchema,
  createProblemDetails,
  ENGAGEMENT_EVENTS_PATH,
  INVESTOR_VIEWS_PATH,
  InvestorViewingDtoSchema,
  MY_ENGAGEMENT_PATH,
  MY_INVESTOR_VIEWING_PATH,
  MyEngagementDtoSchema,
  PROBLEM_CONTENT_TYPE,
  RecordEngagementBatchRequestSchema,
  RecordEngagementBatchResponseSchema,
  RecordInvestorViewRequestSchema,
  VIEWING_PRIVACY_PATH,
  ViewingPrivacyDtoSchema,
} from "@capital-q/contracts";
import type {
  CompanyEngagementReader,
  EngagementService,
  InvestorViews,
  MyEngagementReader,
} from "@capital-q/engagement";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Engagement analytics (Q Workspace §8 A1-A2).
 *
 * The ingest takes what was on the viewer's screen and nothing about who
 * they are: actor, organisation and tenant come from the server-resolved
 * context, the privacy level from the database. The answer is three counts
 * and never which events were refused, so the ingest cannot be used to ask
 * whether a company or document exists.
 *
 * The viewing-privacy setting is the person's own and only theirs.
 */

export type EngagementRoutesDependencies = ActorContextDependencies & {
  readonly engagement: EngagementService;
  readonly companyEngagement: CompanyEngagementReader;
  readonly myEngagement: MyEngagementReader;
  /** Who viewed an investor. Absent: those two routes do not register. */
  readonly investorViews?: InvestorViews | undefined;
};

export function registerEngagementRoutes(
  app: FastifyInstance,
  dependencies: EngagementRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const engagement = dependencies.engagement;

  const invalid = (requestId: string, detail: string) =>
    createProblemDetails({ code: "VALIDATION_FAILED", requestId, detail });

  app.post(
    ENGAGEMENT_EVENTS_PATH,
    { onRequest: withContext, bodyLimit: 32 * 1024 },
    async (request, reply) => {
      const body = RecordEngagementBatchRequestSchema.safeParse(request.body);
      if (!body.success) {
        const problem = invalid(request.id, "Engagement batch is not valid.");
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const result = await engagement.record(
        getActorContext(request),
        body.data,
      );
      void reply.header("Cache-Control", "no-store");
      return reply
        .status(202)
        .send(RecordEngagementBatchResponseSchema.parse(result));
    },
  );

  app.get(
    VIEWING_PRIVACY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const privacy = await engagement.privacy(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      return ViewingPrivacyDtoSchema.parse(privacy);
    },
  );

  // PUT VIEWING_PRIVACY_PATH is the declared app action
  // engagement.viewing_privacy.set (ADR 0040): one declaration for the
  // Settings control and Q's set_viewing_privacy.

  /**
   * A4: the person's own engagement: what they viewed, their visibility,
   * and how founders answered what they asked. Their own records only.
   */
  app.get(
    MY_ENGAGEMENT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const mine = await dependencies.myEngagement.read({
        actorUserId: actor.userId,
        organisationId: actor.organisationId ?? null,
      });
      void reply.header("Cache-Control", "no-store");
      return MyEngagementDtoSchema.parse(mine);
    },
  );

  const investorViews = dependencies.investorViews;
  if (investorViews !== undefined) {
    /**
     * A founder's view of an investor's profile. 202 whatever happened: a
     * view of an investor the founder may not see, of their own firm, or a
     * duplicate are all indistinguishable, so this cannot probe existence.
     */
    app.post(
      INVESTOR_VIEWS_PATH,
      { onRequest: withContext, bodyLimit: 4 * 1024 },
      async (request, reply) => {
        const body = RecordInvestorViewRequestSchema.safeParse(request.body);
        if (!body.success) {
          const problem = invalid(request.id, "The view is not valid.");
          return reply
            .status(problem.status)
            .type(PROBLEM_CONTENT_TYPE)
            .send(problem);
        }
        await investorViews.record(getActorContext(request), body.data);
        void reply.header("Cache-Control", "no-store");
        return reply.status(202).send();
      },
    );

    /**
     * Who viewed the signed-in investor's firm: aggregates only, decided in
     * SQL. Not a member of an investor firm: 404.
     */
    app.get(
      MY_INVESTOR_VIEWING_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const query = CompanyEngagementQuerySchema.safeParse(
          request.query ?? {},
        );
        if (!query.success) {
          const problem = invalid(request.id, "Choose a date.");
          return reply
            .status(problem.status)
            .type(PROBLEM_CONTENT_TYPE)
            .send(problem);
        }
        const actor = getActorContext(request);
        const result = await investorViews.mine({
          actorUserId: actor.userId,
          organisationId: actor.organisationId ?? null,
          since: query.data.since ?? null,
        });
        if (result === null) {
          reply.callNotFound();
          return undefined;
        }
        void reply.header("Cache-Control", "no-store");
        return InvestorViewingDtoSchema.parse(result);
      },
    );
  }

  /**
   * A3: the company's engagement, read by a member of its own
   * organisation. Identity, the floor and the membership check are all
   * decided in SQL; a non-member and a missing company get the same 404.
   */
  app.get(
    COMPANY_ENGAGEMENT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = CompanyEngagementParamsSchema.safeParse(request.params);
      const query = CompanyEngagementQuerySchema.safeParse(request.query ?? {});
      if (!params.success || !query.success) {
        const problem = invalid(request.id, "Choose a company and a date.");
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const result = await dependencies.companyEngagement.read({
        actorUserId: getActorContext(request).userId,
        companyId: params.data.companyId,
        since: query.data.since ?? null,
      });
      if (result === null) {
        reply.callNotFound();
        return undefined;
      }
      void reply.header("Cache-Control", "no-store");
      return CompanyEngagementDtoSchema.parse(result);
    },
  );
}
