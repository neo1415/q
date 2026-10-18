import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  Q_DAILY_EDITION_PATH,
  Q_DAILY_EDITION_PDF_PATH,
  Q_DAILY_PATH,
  Q_DAILY_PREFERENCES_PATH,
  Q_DAILY_REQUESTS_PATH,
  QDailyEditionSchema,
  QDailyHomeDtoSchema,
  QDailyPreferencesSchema,
  QDailyRequestDtoSchema,
  SetQDailyPreferencesRequestSchema,
} from "@capital-q/contracts";
import { newspaperToPdf } from "@capital-q/deck-render";
import type { createDailyReaderService } from "@capital-q/q-daily";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * The Q Daily's routes (DAILY spec §5): the person's own editions, archive,
 * PDF edition and preferences, and "prepare my edition now". Every route
 * reads by the resolved actor's own user and tenant; nothing here takes a
 * person's id. The edition is drawn into a PDF from the stored edition by
 * the same layout the reader shows, with only licensed stock photographs
 * embedded.
 */
export type DailyRoutesDependencies = ActorContextDependencies & {
  readonly daily: ReturnType<typeof createDailyReaderService>;
  readonly now?: (() => Date) | undefined;
  /** Test seam for the PDF's photo fetch. */
  readonly fetch?: typeof fetch | undefined;
};

const EditionParamsSchema = z.object({ editionId: z.string().uuid() }).strict();
const HomeQuerySchema = z
  .object({
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export function registerDailyRoutes(
  app: FastifyInstance,
  dependencies: DailyRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const { daily } = dependencies;
  const now = dependencies.now ?? (() => new Date());

  const own = (request: Parameters<typeof getActorContext>[0]) => {
    const actor = getActorContext(request);
    return { userId: actor.userId, tenantId: actor.tenantId };
  };

  app.get(Q_DAILY_PATH, { onRequest: withContext }, async (request, reply) => {
    const query = HomeQuerySchema.safeParse(request.query ?? {});
    const home = await daily.home(
      own(request),
      query.success ? (query.data.before ?? null) : null,
      now(),
    );
    void reply.header("Cache-Control", "no-store");
    return QDailyHomeDtoSchema.parse(home);
  });

  app.get(
    Q_DAILY_EDITION_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = EditionParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const edition = await daily.edition(own(request), params.data.editionId);
      if (edition === null) return reply.callNotFound();
      void reply.header("Cache-Control", "no-store");
      return QDailyEditionSchema.parse(edition);
    },
  );

  app.get(
    Q_DAILY_EDITION_PDF_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const params = EditionParamsSchema.safeParse(request.params);
      if (!params.success) return reply.callNotFound();
      const edition = await daily.edition(own(request), params.data.editionId);
      if (edition === null) return reply.callNotFound();
      let bytes: Uint8Array;
      try {
        bytes = await newspaperToPdf(edition, {
          ...(dependencies.fetch === undefined
            ? {}
            : { fetch: dependencies.fetch }),
        });
      } catch (error: unknown) {
        request.log.error({ err: error }, "q daily pdf failed to render");
        const problem = createProblemDetails({
          code: "INTERNAL_SERVER_ERROR",
          requestId: request.id,
          detail: "The PDF edition could not be drawn. Please try again.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      return reply
        .code(200)
        .header("content-type", "application/pdf")
        .header("cache-control", "no-store")
        .header(
          "content-disposition",
          `attachment; filename="The-Q-Daily-${edition.editionDate}.pdf"`,
        )
        .send(Buffer.from(bytes));
    },
  );

  app.get(
    Q_DAILY_PREFERENCES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return QDailyPreferencesSchema.parse(
        await daily.preferences(own(request), now()),
      );
    },
  );

  app.put(
    Q_DAILY_PREFERENCES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const body = SetQDailyPreferencesRequestSchema.safeParse(request.body);
      if (!body.success) {
        const problem = createProblemDetails({
          code: "INVALID_REQUEST",
          requestId: request.id,
          detail: "Choose how often, whether to email it, and which sections.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      void reply.header("Cache-Control", "no-store");
      return QDailyPreferencesSchema.parse(
        await daily.setPreferences(own(request), body.data, now()),
      );
    },
  );

  // Idempotent by design: asking twice inside the window queues one edition.
  app.post(
    Q_DAILY_REQUESTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      void reply.header("Cache-Control", "no-store");
      return QDailyRequestDtoSchema.parse(
        await daily.request(own(request), now()),
      );
    },
  );
}
