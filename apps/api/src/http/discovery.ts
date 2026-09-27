import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
} from "@capital-q/contracts";
import type {
  DiscoveryService,
  InteractionSignalService,
  SlateReadService,
} from "@capital-q/discovery";
import type {
  DiscoverablePitch,
  DiscoverablePitchQueryPort,
} from "@capital-q/media";

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
  /** Persisted recommendation slates (CQ-REC-006): the companies feed. */
  readonly slates: SlateReadService;
  /**
   * The Media context's feed read (CQ-MEDIA-012): which of a page's
   * companies have a publishable pitch. Absent, every item's pitch is null
   * — a feed without video is still a feed (doc 20 §137).
   */
  readonly pitches?: DiscoverablePitchQueryPort | undefined;
  /**
   * The viewer's own saved state for a page's companies (the interaction
   * projection), so a save survives a reload. Absent, or failing, the
   * page is served without it: a feed without saved marks is still a feed.
   */
  readonly interactions?:
    Pick<InteractionSignalService, "stateForCompanies"> | undefined;
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
  const slates = dependencies.slates;

  // The investor's feed comes from the persisted, precomputed slate
  // (CQ-REC-006): a page after a cursor, re-checked for this actor at read
  // time. Nothing internal reaches the wire: the reader hands over the
  // declared card and bounded alignment codes, and nothing else exists on
  // the DTO to carry a score, a snapshot or a mandate field.
  app.get(
    DISCOVERY_COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const page = pageOf(request);
      const served = await slates.pageCompanies({
        actor: getActorContext(request),
        limit: page.limit,
        cursor: page.cursor,
      });
      // One batched read for the whole page, after the reader has decided
      // which companies this viewer may see (doc 20 §78). Only a
      // publishable pitch comes back, and it carries no provider id and no
      // URL: the client asks `/playback` for each item it activates.
      const pitches =
        dependencies.pitches === undefined || served.items.length === 0
          ? new Map<string, DiscoverablePitch>()
          : await dependencies.pitches.findDiscoverablePitches(
              served.items.map((item) => item.companyId),
            );
      const states =
        dependencies.interactions === undefined || served.items.length === 0
          ? null
          : await dependencies.interactions
              .stateForCompanies({
                actor: getActorContext(request),
                companyIds: served.items.map((item) => item.companyId),
              })
              .catch(() => null);
      void reply.header("Cache-Control", "no-store");
      return DiscoveryCompanySlateDtoSchema.parse({
        slateId: served.slateId,
        rankingVersion: served.rankingVersion,
        items: served.items.map((item) => {
          const pitch = pitches.get(item.companyId);
          return {
            companyId: item.companyId,
            canonicalName: item.canonicalName,
            websiteUrl: item.websiteUrl,
            headquartersCountry: item.headquartersCountry,
            currentStageCode: item.currentStageCode,
            shortDescription: item.shortDescription,
            reasons: [],
            reasonCodes: item.reasonCodes,
            unverifiedExclusions: item.unverifiedExclusions,
            ...(states === null
              ? {}
              : { viewerSaved: states.get(item.companyId)?.saved === true }),
            pitch:
              pitch === undefined
                ? null
                : {
                    mediaAssetId: pitch.mediaAssetId,
                    aspectRatio: pitch.aspectRatio,
                    durationSeconds: pitch.durationSeconds,
                    captionState: pitch.captionState,
                  },
          };
        }),
        notes: served.notes,
        nextCursor: served.nextCursor,
        unverifiableExclusions: served.unverifiableExclusions,
        excludingRules: served.excludingRules,
        discoverableCount: served.discoverableCount,
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
