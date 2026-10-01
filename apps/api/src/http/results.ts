import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  RESULTS_PATH,
  RESULTS_REPORT_PATH,
  ResultsDtoSchema,
  ResultsQuerySchema,
} from "@capital-q/contracts";
import {
  resultsCsv,
  resultsPdf,
  resultsWindow,
  type ResultsReader,
} from "@capital-q/results";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * A person's own results and the report they download (spec §5). The
 * actor's organisation comes from the server-resolved context only; the
 * reader never takes an organisation, company or firm from the request.
 */

export type ResultsRoutesDependencies = ActorContextDependencies & {
  readonly results: ResultsReader;
  readonly now?: (() => Date) | undefined;
};

function fileName(name: string, from: string | null, to: string, ext: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `capital-q-results-${slug || "report"}-${from ?? "start"}-to-${to}.${ext}`;
}

export function registerResultsRoutes(
  app: FastifyInstance,
  dependencies: ResultsRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const now = dependencies.now ?? (() => new Date());

  app.get(RESULTS_PATH, { onRequest: withContext }, async (request, reply) => {
    const query = ResultsQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      const problem = createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId: request.id,
        detail: "Choose a valid date range.",
      });
      return reply
        .status(problem.status)
        .type(PROBLEM_CONTENT_TYPE)
        .send(problem);
    }
    const window = resultsWindow(query.data, now());
    const results = await dependencies.results.read(
      getActorContext(request),
      window,
    );
    void reply.header("Cache-Control", "no-store");
    return ResultsDtoSchema.parse(results);
  });

  app.get(
    RESULTS_REPORT_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = ResultsQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        const problem = createProblemDetails({
          code: "VALIDATION_FAILED",
          requestId: request.id,
          detail: "Choose a valid date range and format.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const window = resultsWindow(query.data, now());
      const results = await dependencies.results.read(
        getActorContext(request),
        window,
      );
      if (results.side === "NONE") {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
          detail: "There are no results to report yet.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const format = query.data.format ?? "pdf";
      const name = fileName(
        results.organisationName,
        window.from,
        window.to,
        format,
      );
      void reply
        .header("Cache-Control", "no-store")
        .header("Content-Disposition", `attachment; filename="${name}"`);
      if (format === "csv") {
        return reply.type("text/csv; charset=utf-8").send(resultsCsv(results));
      }
      const generated = now().toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      const pdf = await resultsPdf(results, generated);
      return reply.type("application/pdf").send(Buffer.from(pdf));
    },
  );
}
