import type { FastifyInstance } from "fastify";

import {
  createProblemDetails,
  FIT_COMPARE_PATH,
  FIT_PARAMETERS,
  FIT_THESIS_PATH,
  FitCompareQuerySchema,
  FitComparisonDtoSchema,
  PROBLEM_CONTENT_TYPE,
  ThesisReadingDtoSchema,
} from "@capital-q/contracts";
import { FIT_CONFIG_CURRENT, type FitService } from "@capital-q/discovery";
import type { ActorContext } from "@capital-q/security";
import type { ThesisReadingDto } from "@capital-q/contracts";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Investor promises on the Q API (2026-10-07), beside `/v1/fit`:
 *
 *   GET /v1/fit/compare?ids=a,b   Q.10: 2-4 picked companies side by side
 *   GET /v1/fit/thesis            Q.02: how Q reads the investor's thesis
 *
 * Thin: the fit service re-checks VIEW eligibility for every id before
 * anything is read, and the thesis reader reads through the investor
 * service as the person (their own organisation only). The same reads
 * back Q's fit_compare and thesis_reading tools.
 */

export type InvestorPromiseRoutesDependencies = ActorContextDependencies & {
  readonly fit: Pick<FitService, "compare">;
  readonly thesis: (actor: ActorContext) => Promise<ThesisReadingDto | null>;
};

export function registerInvestorPromiseRoutes(
  app: FastifyInstance,
  dependencies: InvestorPromiseRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(
    FIT_COMPARE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = FitCompareQuerySchema.safeParse(request.query ?? {});
      void reply.header("Cache-Control", "no-store");
      const result = query.success
        ? await dependencies.fit.compare(
            getActorContext(request),
            query.data.ids,
          )
        : null;
      return FitComparisonDtoSchema.parse(
        result?.kind === "OK"
          ? result.comparison
          : {
              configVersion: FIT_CONFIG_CURRENT.version,
              configLabel: FIT_CONFIG_CURRENT.label,
              parameters: [...FIT_PARAMETERS],
              entries: [],
              considered: 0,
              leftOut: { outsideMandate: 0, notEnoughInformation: 0 },
              computedAt: new Date().toISOString(),
            },
      );
    },
  );

  app.get(
    FIT_THESIS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const reading = await dependencies.thesis(getActorContext(request));
      void reply.header("Cache-Control", "no-store");
      if (reading === null) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
          detail: "How Q reads a thesis is for an investor's own mandate.",
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      return ThesisReadingDtoSchema.parse(reading);
    },
  );
}
