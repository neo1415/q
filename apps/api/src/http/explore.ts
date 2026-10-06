import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  DISCOVERY_EXPLORE_PATH,
  DISCOVERY_EXPLORE_RELATED_PATH,
  DISCOVERY_EXPLORE_SEARCH_PATH,
  ExploreModeSchema,
  ExplorePageDtoSchema,
  ExploreRelatedDtoSchema,
  ExploreSearchDtoSchema,
  PROBLEM_CONTENT_TYPE,
  UuidSchema,
  type ExploreCompanyResultDto,
  type ExploreReasonCode,
  type ExploreSource,
  type ExploreTileDto,
} from "@capital-q/contracts";
import {
  EXPLORE_RANKING_VERSION,
  ExploreCursorRejectedError,
  matchesExploreText,
  normaliseExploreText,
  type ExplorePitch,
  type ExploreService,
} from "@capital-q/discovery";
import { pitchSummary } from "@capital-q/media";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * Explore (E1-E5, ADR 0055). Three reads, all for a signed-in participant,
 * all over the one pool the Explore service builds after disclosure:
 *
 *   GET /v1/discovery/explore                   a cursor page of the slate
 *   GET /v1/discovery/explore/related/:id       the opened pitch, then pitches like it
 *   GET /v1/discovery/explore/search?q=         companies and pitches that match
 *
 * Nothing here records a view: Explore is a read, and viewing is not
 * interest. No count, score or rank reaches the wire.
 */

export type ExploreRow = Parameters<typeof pitchSummary>[0] & {
  readonly createdAt: string;
};

export type ExploreRoutesDependencies = ActorContextDependencies & {
  readonly explore: ExploreService<ExploreRow>;
};

function tile(
  pitch: ExplorePitch<ExploreRow>,
  source: ExploreSource,
  reason: ExploreReasonCode,
): ExploreTileDto {
  return {
    companyId: pitch.companyId,
    canonicalName: pitch.company.canonicalName,
    shortDescription: pitch.company.shortDescription,
    headquartersCountry: pitch.company.headquartersCountry,
    currentStageCode: pitch.company.currentStageCode,
    sectorNodeIds: [...pitch.sectorNodeIds].slice(0, 8),
    pitch: pitchSummary(pitch.row),
    postedAt: pitch.postedAt,
    source,
    reason,
  };
}

function badRequest(request: FastifyRequest, reply: FastifyReply) {
  const problem = createProblemDetails({
    code: "VALIDATION_FAILED",
    requestId: request.id,
  });
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  const problem = createProblemDetails({
    code: "RESOURCE_NOT_FOUND",
    requestId: request.id,
  });
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

export function registerExploreRoutes(
  app: FastifyInstance,
  dependencies: ExploreRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const explore = dependencies.explore;

  app.get(
    DISCOVERY_EXPLORE_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const mode = ExploreModeSchema.safeParse(query["mode"] ?? "FOR_YOU");
      const rawLimit =
        typeof query["limit"] === "string"
          ? Number.parseInt(query["limit"], 10)
          : undefined;
      const cursor =
        typeof query["cursor"] === "string" && query["cursor"].length > 0
          ? query["cursor"]
          : null;
      if (!mode.success || (cursor !== null && cursor.length > 400)) {
        return badRequest(request, reply);
      }
      void reply.header("Cache-Control", "no-store");
      try {
        const page = await explore.page(getActorContext(request), {
          mode: mode.data,
          cursor,
          limit:
            rawLimit === undefined || Number.isNaN(rawLimit)
              ? undefined
              : rawLimit,
        });
        return ExplorePageDtoSchema.parse({
          rankingVersion: EXPLORE_RANKING_VERSION,
          mode: mode.data,
          items: page.items.map((c) => tile(c.item, c.source, c.reason)),
          nextCursor: page.nextCursor,
          upToDate: page.upToDate,
        });
      } catch (error) {
        if (error instanceof ExploreCursorRejectedError) {
          return badRequest(request, reply);
        }
        throw error;
      }
    },
  );

  app.get(
    DISCOVERY_EXPLORE_RELATED_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const id = UuidSchema.safeParse(
        (request.params as { mediaAssetId?: unknown }).mediaAssetId,
      );
      if (!id.success) return badRequest(request, reply);
      void reply.header("Cache-Control", "no-store");
      const found = await explore.related(getActorContext(request), {
        mediaAssetId: id.data,
      });
      // Hidden and missing look the same: nothing to say a pitch exists.
      if (found === null) return notFound(request, reply);
      return ExploreRelatedDtoSchema.parse({
        anchor: tile(found.anchor, "NEWEST", "ON_THE_NETWORK"),
        items: found.items.map((r) => ({
          ...tile(r.item, "EXPLORATION", "ON_THE_NETWORK"),
          related: r.related,
        })),
      });
    },
  );

  app.get(
    DISCOVERY_EXPLORE_SEARCH_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const raw = (request.query as { q?: unknown }).q;
      const text = typeof raw === "string" ? normaliseExploreText(raw) : "";
      void reply.header("Cache-Control", "no-store");
      if (text.length === 0) {
        return ExploreSearchDtoSchema.parse({
          query: "",
          companies: [],
          pitches: [],
        });
      }
      const pool = await explore.pool(getActorContext(request));
      const pitches = pool.filter((p) => matchesExploreText(p.company, text));
      const companies = new Map<string, ExploreCompanyResultDto>();
      for (const p of pitches) {
        if (companies.has(p.companyId)) continue;
        companies.set(p.companyId, {
          companyId: p.companyId,
          canonicalName: p.company.canonicalName,
          shortDescription: p.company.shortDescription,
          headquartersCountry: p.company.headquartersCountry,
          currentStageCode: p.company.currentStageCode,
        });
      }
      return ExploreSearchDtoSchema.parse({
        query: text,
        companies: [...companies.values()].slice(0, 30),
        pitches: pitches
          .slice(0, 30)
          .map((p) => tile(p, "EXPLORATION", "ON_THE_NETWORK")),
      });
    },
  );
}
