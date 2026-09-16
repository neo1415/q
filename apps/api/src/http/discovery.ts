import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
} from "@capital-q/contracts";
import type { DiscoveryService } from "@capital-q/discovery";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/discovery` — the slate (doc 19).
 *
 * Read-only, cursor-paged, and thin by design: the handler parses the
 * query, calls the service and maps the DTO. Every rule about who is
 * eligible, what may be matched on and how a slate is ordered belongs to
 * the discovery context, and the `rank` each item carries is dropped here
 * because a score is not a verdict to show anyone.
 */

export type DiscoveryRoutesDependencies = ActorContextDependencies & {
  readonly discovery: DiscoveryService;
};

type PageQuery = {
  readonly limit?: string | undefined;
  readonly cursor?: string | undefined;
};

function pageOf(request: FastifyRequest): {
  readonly limit: number | undefined;
  readonly cursor: string | null;
} {
  const query = request.query as PageQuery;
  const limit =
    query.limit === undefined ? undefined : Number.parseInt(query.limit, 10);
  return {
    limit: limit === undefined || Number.isNaN(limit) ? undefined : limit,
    cursor:
      query.cursor === undefined || query.cursor.length === 0
        ? null
        : query.cursor,
  };
}

export function registerDiscoveryRoutes(
  app: FastifyInstance,
  dependencies: DiscoveryRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.discovery;

  app.get(
    DISCOVERY_COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const page = pageOf(request);
      const slate = await service.discoverCompanies({
        actor: getActorContext(request),
        limit: page.limit,
        cursor: page.cursor,
      });
      void reply.header("Cache-Control", "no-store");
      return DiscoveryCompanySlateDtoSchema.parse({
        rankingVersion: slate.rankingVersion,
        // The rank stays server-side: it reproduces a slate, it does not
        // describe a company.
        items: slate.items.map(({ rank: _rank, ...item }) => item),
        notes: slate.notes,
        nextCursor: slate.nextCursor,
      });
    },
  );

  app.get(
    DISCOVERY_INVESTORS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const page = pageOf(request);
      const slate = await service.discoverInvestors({
        actor: getActorContext(request),
        limit: page.limit,
        cursor: page.cursor,
      });
      void reply.header("Cache-Control", "no-store");
      return DiscoveryInvestorSlateDtoSchema.parse({
        rankingVersion: slate.rankingVersion,
        items: slate.items.map(({ rank: _rank, ...item }) => item),
        notes: slate.notes,
        nextCursor: slate.nextCursor,
      });
    },
  );
}
