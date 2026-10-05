import type { FastifyInstance } from "fastify";

import {
  FIT_COMPANIES_PATH,
  FIT_COMPANY_PATH,
  FIT_PARAMETERS,
  FIT_Q_VIEW_PATH,
  FIT_TOP_PATH,
  FitComparisonDtoSchema,
  FitCompaniesQuerySchema,
  FitProfileDtoSchema,
  FitProfileListDtoSchema,
  FitTopQuerySchema,
  QViewDtoSchema,
  UuidSchema,
  type FitComparisonDto,
} from "@capital-q/contracts";
import { FIT_CONFIG_CURRENT, type FitService } from "@capital-q/discovery";
import { createCorrelationId } from "@capital-q/observability";
import type { FitQViews } from "../composition/fit.js";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/fit` — fit with the reader's own mandate (B1-B3; ADR 0052).
 *
 * Thin by design: every rule about who may see which company, what a
 * declared rule excludes and how a profile is computed belongs to the fit
 * service (discovery). A company the reader may not see, one that does
 * not exist and a malformed id are the same answer — absent, or 404 — so
 * a probe learns nothing. No response carries the internal value.
 *
 * Q's view has its own path because it is a model call: the cards render
 * the fit at once and ask for Q's view after, off the critical path.
 */

export type FitRoutesDependencies = ActorContextDependencies & {
  readonly fit: FitService;
  readonly qViews: FitQViews;
};

type Params = { readonly companyId?: string | undefined };

const EMPTY_COMPARISON = (computedAt: string): FitComparisonDto => ({
  configVersion: FIT_CONFIG_CURRENT.version,
  configLabel: FIT_CONFIG_CURRENT.label,
  parameters: [...FIT_PARAMETERS],
  entries: [],
  considered: 0,
  leftOut: { outsideMandate: 0, notEnoughInformation: 0 },
  computedAt,
});

export function registerFitRoutes(
  app: FastifyInstance,
  dependencies: FitRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);

  app.get(
    FIT_COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = FitCompaniesQuerySchema.safeParse(request.query ?? {});
      void reply.header("Cache-Control", "no-store");
      if (!query.success) return FitProfileListDtoSchema.parse({ items: [] });
      const result = await dependencies.fit.profiles(
        getActorContext(request),
        query.data.ids,
      );
      return FitProfileListDtoSchema.parse({
        items:
          result.kind === "OK"
            ? result.items.map((item) => item.assessment.profile)
            : [],
      });
    },
  );

  app.get(
    FIT_COMPANY_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const companyId = UuidSchema.safeParse(
        (request.params as Params).companyId,
      );
      if (!companyId.success) return reply.callNotFound();
      const result = await dependencies.fit.profiles(getActorContext(request), [
        companyId.data,
      ]);
      const item = result.kind === "OK" ? result.items[0] : undefined;
      if (item === undefined) return reply.callNotFound();
      void reply.header("Cache-Control", "no-store");
      return FitProfileDtoSchema.parse(item.assessment.profile);
    },
  );

  app.get(
    FIT_Q_VIEW_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const companyId = UuidSchema.safeParse(
        (request.params as Params).companyId,
      );
      if (!companyId.success) return reply.callNotFound();
      const actor = getActorContext(request);
      const result = await dependencies.fit.profiles(actor, [companyId.data]);
      const item = result.kind === "OK" ? result.items[0] : undefined;
      if (item === undefined) return reply.callNotFound();
      const view = await dependencies.qViews.viewFor({
        actor,
        item,
        correlationId: createCorrelationId(),
      });
      void reply.header("Cache-Control", "no-store");
      return QViewDtoSchema.parse(view);
    },
  );

  app.get(FIT_TOP_PATH, { onRequest: withContext }, async (request, reply) => {
    const query = FitTopQuerySchema.safeParse(request.query ?? {});
    const result = await dependencies.fit.top(
      getActorContext(request),
      query.success ? query.data.limit : 3,
    );
    void reply.header("Cache-Control", "no-store");
    return FitComparisonDtoSchema.parse(
      result.kind === "OK"
        ? result.comparison
        : EMPTY_COMPARISON(new Date().toISOString()),
    );
  });
}
