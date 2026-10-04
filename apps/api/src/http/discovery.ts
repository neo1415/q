import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  createProblemDetails,
  PROBLEM_CONTENT_TYPE,
  DISCOVER_FILTER_QUERY_KEYS,
  DiscoverFiltersQuerySchema,
  DISCOVERY_COMPANIES_PATH,
  DISCOVERY_INVESTOR_PATH,
  DISCOVERY_INVESTORS_PATH,
  DiscoveredInvestorProfileDtoSchema,
  DISCOVERY_NETWORK_PITCHES_PATH,
  DiscoveryCompanySlateDtoSchema,
  DiscoveryInvestorSlateDtoSchema,
  NetworkPitchPageDtoSchema,
  type NetworkPitchItemDto,
  parseContract,
  NetworkPitchCursorSchema,
  type DiscoverFilters,
  DISCOVERY_YOUR_COMPANIES_PATH,
  YourCompaniesPageDtoSchema,
  DISCOVERY_INVESTOR_PHOTO_PATH,
  DiscoveredInvestorPhotoDtoSchema,
  type YourCompanyLabel,
  type YourCompanyPitchItemDto,
  type FeedCompanySummaryDto,
} from "@capital-q/contracts";
import type {
  DiscoveryService,
  InteractionSignalService,
  SlateReadService,
} from "@capital-q/discovery";
import {
  NETWORK_PITCH_PAGE_MAX,
  pitchSummary,
  type DiscoverablePitchQueryPort,
  type DiscoverablePitchSet,
  type NetworkPitchQueryPort,
} from "@capital-q/media";
import { namedImageKey, type NamedImages } from "@capital-q/public-identity";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import { photoLookup, type NamedPhotos } from "./named-photos.js";

/**
 * `/v1/discovery` — the slate (doc 19).
 *
 * Read-only, cursor-paged, and thin by design: the handler parses the
 * query, calls the service and maps the DTO. Every rule about who is
 * eligible, what may be matched on and how a slate is ordered belongs to
 * the discovery context, and the `rank` each item carries is dropped here
 * because a score is not a verdict to show anyone.
 */

/** An investor organisation's own photo and cover (signed URLs), or null. */
export type InvestorImagesPort = (investorOrganisationId: string) => Promise<{
  readonly photo: string | null;
  readonly cover: string | null;
}>;

export type DiscoveryRoutesDependencies = ActorContextDependencies & {
  /**
   * ADR 0023: investors' images on founder-facing reads. Called only for
   * investors the discovery service already returned to this reader.
   * Absent, or failing, a card shows the investor's initials.
   */
  readonly investorImages?: InvestorImagesPort | undefined;
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
   * Discover v2: each card's declared facts for THIS reader (sector, and
   * the raise only where disclosure lets them view it), one batch per
   * page, asked only for companies the slate reader already allowed.
   * Absent or failing: cards carry no summary, never a guessed one.
   */
  readonly feedSummaries?:
    | ((
        actor: ActorContext,
        companyIds: readonly string[],
      ) => Promise<ReadonlyMap<string, FeedCompanySummaryDto>>)
    | undefined;
  /**
   * The viewer's own saved state for a page's companies (the interaction
   * projection), so a save survives a reload. Absent, or failing, the
   * page is served without it: a feed without saved marks is still a feed.
   */
  readonly interactions?:
    Pick<InteractionSignalService, "stateForCompanies"> | undefined;
  /**
   * Videos opened to everyone on Capital Q (ADR 0021), and the company as
   * this viewer may see it (disclosure: network-visible or wider, else
   * null). Both absent: the network feed is empty.
   */
  readonly networkPitches?: NetworkPitchQueryPort | undefined;
  readonly networkCompany?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<{
        readonly canonicalName: string;
        readonly shortDescription: string | null;
        readonly headquartersCountry: string | null;
        readonly currentStageCode: string | null;
        readonly companyStatus: string;
      } | null>)
    | undefined;
  /**
   * "Your companies" (founder decision 2026-10-02): the investor's own
   * connected, interested and saved companies, by identity, from the
   * Network and interaction contexts. Absent: the row is empty.
   */
  readonly yourCompanies?:
    | ((actor: ActorContext) => Promise<
        readonly {
          readonly companyId: string;
          readonly label: YourCompanyLabel;
          /** Their latest activity together; null when none is known. */
          readonly activityAt?: string | null | undefined;
        }[]
      >)
    | undefined;
  /** The playback rule; absent, the row is empty rather than unplayable. */
  readonly mayPlay?: YourCompaniesMayPlay | undefined;
  /** Pictures of who a response names. Absent: initials everywhere. */
  readonly namedPhotos?: NamedPhotos | undefined;
};

/**
 * Whether this viewer may play this pitch: the media service's own
 * playback rule (the one that signs a play), as a yes or no. The row lists
 * only what will play (live 2026-10-02: four INVESTORS pitches of
 * companies outside the investor's mandate were listed and refused).
 */
export type YourCompaniesMayPlay = (
  actor: ActorContext,
  companyId: string,
  mediaAssetId: string,
) => Promise<boolean>;

/** How many of their own companies the row considers at most. */
const YOUR_COMPANIES_MAX = 200;
const YOUR_COMPANIES_PAGE_DEFAULT = 10;
const YOUR_COMPANIES_PAGE_MAX = 20;

function encodeNetworkCursor(createdAt: string, mediaAssetId: string): string {
  return Buffer.from(JSON.stringify({ createdAt, mediaAssetId })).toString(
    "base64url",
  );
}

function decodeNetworkCursor(
  cursor: string | null,
): { readonly createdAt: string; readonly mediaAssetId: string } | null {
  if (cursor === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    raw = null;
  }
  return parseContract(
    NetworkPitchCursorSchema,
    raw,
    "The cursor is not valid.",
  );
}

const NETWORK_PAGE_DEFAULT = 18;

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

/**
 * The Discover filter parameters, if any (lead-owned contract change,
 * ux/discover-filters). The query is external input: only the named keys
 * are read, and a malformed one is refused, never a silently wider feed.
 */
function filtersOf(request: FastifyRequest): DiscoverFilters {
  const query = request.query as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of DISCOVER_FILTER_QUERY_KEYS) {
    if (query[key] !== undefined) picked[key] = query[key];
  }
  return parseContract(
    DiscoverFiltersQuerySchema,
    picked,
    "The Discover filters are not valid.",
  );
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
      const filters = filtersOf(request);
      const served = await slates.pageCompanies({
        actor: getActorContext(request),
        limit: page.limit,
        cursor: page.cursor,
        filters,
      });
      // One batched read for the whole page, after the reader has decided
      // which companies this viewer may see (doc 20 §78). Only a
      // publishable pitch comes back, and it carries no provider id and no
      // URL: the client asks `/playback` for each item it activates.
      const pitches =
        dependencies.pitches === undefined || served.items.length === 0
          ? new Map<string, DiscoverablePitchSet>()
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
      const companyIds = served.items.map((item) => item.companyId);
      const [summaries, photos] = await Promise.all([
        dependencies.feedSummaries === undefined || companyIds.length === 0
          ? null
          : dependencies
              .feedSummaries(getActorContext(request), companyIds)
              .catch(() => null),
        // The card's avatar opens the profile; its photo is the company's
        // Q Card `photo` scope, for signed-in participants, one batch.
        dependencies.namedPhotos === undefined || companyIds.length === 0
          ? null
          : dependencies.namedPhotos
              .images(
                companyIds.map((companyId) => ({
                  subjectType: "COMPANY" as const,
                  subjectId: companyId,
                })),
                "PARTICIPANT",
              )
              .catch(() => null),
      ]);
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
            ...(item.reintroduced === undefined
              ? {}
              : {
                  sinceYouLastSaw: {
                    change:
                      item.reintroduced.change === "NEW_PITCH"
                        ? ("NEW_PITCH" as const)
                        : null,
                  },
                }),
            ...(item.filterUnknown === undefined
              ? {}
              : { filterUnknown: item.filterUnknown }),
            ...(states === null
              ? {}
              : { viewerSaved: states.get(item.companyId)?.saved === true }),
            ...(photos === null
              ? {}
              : {
                  photoUrl:
                    photos.get(
                      namedImageKey({
                        subjectType: "COMPANY",
                        subjectId: item.companyId,
                      }),
                    )?.photo ?? null,
                }),
            ...(summaries?.get(item.companyId) === undefined
              ? {}
              : { summary: summaries.get(item.companyId) }),
            pitch: pitch === undefined ? null : pitchSummary(pitch),
            ...(pitch === undefined || pitch.more.length === 0
              ? {}
              : { morePitches: pitch.more.map(pitchSummary) }),
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

  // Founders' network videos (ADR 0021): newest first, no ranking. Every
  // company passes the same disclosure read the network preview uses
  // before anything about it is returned; a company hidden since its
  // video was opened simply drops out.
  app.get(
    DISCOVERY_NETWORK_PITCHES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const page = pageOf(request);
      const limit = Math.max(
        1,
        Math.min(NETWORK_PITCH_PAGE_MAX, page.limit ?? NETWORK_PAGE_DEFAULT),
      );
      void reply.header("Cache-Control", "no-store");
      if (
        dependencies.networkPitches === undefined ||
        dependencies.networkCompany === undefined
      ) {
        return NetworkPitchPageDtoSchema.parse({ items: [], nextCursor: null });
      }
      const networkPitches = dependencies.networkPitches;
      const networkCompany = dependencies.networkCompany;
      // Search (founder direction 2026-09-29): an optional text matched
      // against what the network already shows of each company, after the
      // disclosure read, so it can never match on anything hidden.
      const rawText = (request.query as { readonly q?: string }).q;
      const text =
        typeof rawText === "string"
          ? rawText.trim().toLowerCase().slice(0, 80)
          : "";
      const companies = new Map<
        string,
        Awaited<ReturnType<typeof networkCompany>>
      >();
      const items: NetworkPitchItemDto[] = [];
      let before = decodeNetworkCursor(page.cursor);
      let nextCursor: string | null = null;
      // Without a search, one page as before; with one, a few pages are
      // read until a page of matches is found.
      for (let scanned = 0; scanned < (text.length === 0 ? 1 : 4); scanned++) {
        const batch = text.length === 0 ? limit : NETWORK_PITCH_PAGE_MAX;
        const rows = await networkPitches.findNetworkPitches({
          excludeOwnerOrganisationId: actor.organisationId ?? null,
          before,
          limit: batch,
        });
        for (const companyId of new Set(rows.map((row) => row.companyId))) {
          if (companies.has(companyId)) continue;
          companies.set(
            companyId,
            await networkCompany(actor, companyId).catch(() => null),
          );
        }
        for (const row of rows) {
          const company = companies.get(row.companyId) ?? null;
          if (company === null || company.companyStatus !== "active") continue;
          if (
            text.length > 0 &&
            !`${company.canonicalName} ${company.shortDescription ?? ""}`
              .toLowerCase()
              .includes(text)
          ) {
            continue;
          }
          items.push({
            companyId: row.companyId,
            canonicalName: company.canonicalName,
            shortDescription: company.shortDescription,
            headquartersCountry: company.headquartersCountry,
            currentStageCode: company.currentStageCode,
            pitch: pitchSummary(row),
            postedAt: row.createdAt,
          });
        }
        const last = rows.at(-1);
        nextCursor =
          rows.length === batch && last !== undefined
            ? encodeNetworkCursor(last.createdAt, last.mediaAssetId)
            : null;
        if (
          nextCursor === null ||
          items.length >= limit ||
          last === undefined
        ) {
          break;
        }
        before = decodeNetworkCursor(nextCursor);
      }
      return NetworkPitchPageDtoSchema.parse({ items, nextCursor });
    },
  );

  // "Your companies" (founder decisions 2026-10-02, 2026-10-04): Discover's
  // second tab, never part of the recommended feed. Every company they are
  // connected with (and later), interested in or saved, most recent
  // activity first. Each company passes the same disclosure read the
  // network preview uses; a pitch is carried only when the media service
  // would sign it for this viewer, and each play is authorised again.
  app.get(
    DISCOVERY_YOUR_COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const page = pageOf(request);
      const limit = Math.max(
        1,
        Math.min(
          YOUR_COMPANIES_PAGE_MAX,
          page.limit ?? YOUR_COMPANIES_PAGE_DEFAULT,
        ),
      );
      void reply.header("Cache-Control", "no-store");
      const empty = YourCompaniesPageDtoSchema.parse({
        items: [],
        nextCursor: null,
      });
      const pitches = dependencies.pitches;
      const networkCompany = dependencies.networkCompany;
      const mayPlay = dependencies.mayPlay;
      if (
        dependencies.yourCompanies === undefined ||
        pitches === undefined ||
        networkCompany === undefined ||
        mayPlay === undefined
      ) {
        return empty;
      }
      const own = (
        await dependencies.yourCompanies(actor).catch(() => [])
      ).slice(0, YOUR_COMPANIES_MAX);
      if (own.length === 0) return empty;
      const ids = own.map((entry) => entry.companyId);
      const [sets, readyAt] = await Promise.all([
        pitches.findDiscoverablePitches(ids),
        pitches.latestReadyAt?.(ids) ??
          Promise.resolve(new Map<string, string>()),
      ]);
      const after = decodeNetworkCursor(page.cursor);
      // Every company of theirs, most recent activity first (follow-55):
      // one without a pitch they may play is still theirs, shown as
      // "Pitch not shared". Ties by company id, so the cursor is total.
      const EPOCH = new Date(0).toISOString();
      const ordered = own
        .map((entry) => {
          const ready = readyAt.get(entry.companyId);
          const at =
            entry.activityAt ?? (ready === undefined ? null : ready) ?? null;
          return {
            ...entry,
            set: sets.get(entry.companyId),
            ready: ready === undefined ? null : new Date(ready).toISOString(),
            at: at === null ? EPOCH : new Date(at).toISOString(),
          };
        })
        .sort((a, b) =>
          a.at === b.at
            ? b.companyId.localeCompare(a.companyId)
            : b.at.localeCompare(a.at),
        )
        .filter(
          (entry) =>
            after === null ||
            entry.at < after.createdAt ||
            (entry.at === after.createdAt &&
              entry.companyId < after.mediaAssetId),
        );
      const items: YourCompanyPitchItemDto[] = [];
      let last: (typeof ordered)[number] | undefined;
      for (const entry of ordered) {
        if (items.length >= limit) break;
        last = entry;
        // The same disclosure read the network preview uses: a company no
        // longer visible to them is not listed at all.
        const company = await networkCompany(actor, entry.companyId).catch(
          () => null,
        );
        if (company === null || company.companyStatus !== "active") continue;
        // One predicate with the player: a pitch is carried only when the
        // playback rule will sign it for this viewer (purpose VIEW; ADR
        // 0041). Otherwise the card says the pitch is not shared.
        const playable =
          entry.set !== undefined &&
          (await mayPlay(actor, entry.companyId, entry.set.mediaAssetId).catch(
            () => false,
          ));
        items.push({
          companyId: entry.companyId,
          canonicalName: company.canonicalName,
          shortDescription: company.shortDescription,
          headquartersCountry: company.headquartersCountry,
          currentStageCode: company.currentStageCode,
          label: entry.label,
          pitch:
            playable && entry.set !== undefined
              ? pitchSummary(entry.set)
              : null,
          readyAt: playable ? entry.ready : null,
          activityAt: entry.at,
        });
      }
      const more =
        last !== undefined && ordered.indexOf(last) < ordered.length - 1;
      // Each card names its company, so the logo shows with the name; the
      // cover keeps the company's own card scope for a participant. One
      // batch for the page.
      const images =
        dependencies.namedPhotos === undefined || items.length === 0
          ? new Map<string, NamedImages>()
          : await dependencies.namedPhotos
              .images(
                items.map((item) => ({
                  subjectType: "COMPANY" as const,
                  subjectId: item.companyId,
                })),
                "PARTICIPANT",
              )
              .catch(() => new Map<string, NamedImages>());
      return YourCompaniesPageDtoSchema.parse({
        items: items.map((item) => {
          const image = images.get(
            namedImageKey({
              subjectType: "COMPANY",
              subjectId: item.companyId,
            }),
          );
          return {
            ...item,
            photoUrl: image?.photo ?? null,
            coverUrl: image?.cover ?? null,
          };
        }),
        nextCursor:
          more && last !== undefined
            ? encodeNetworkCursor(last.at, last.companyId)
            : null,
      });
    },
  );

  const imagesOf = async (
    investorOrganisationId: string,
  ): Promise<{ photoUrl?: string | null; coverUrl?: string | null }> => {
    if (dependencies.investorImages === undefined) return {};
    try {
      const images = await dependencies.investorImages(investorOrganisationId);
      return { photoUrl: images.photo, coverUrl: images.cover };
    } catch {
      return {};
    }
  };

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
      const items = await Promise.all(
        slate.items.map(async ({ rank: _rank, ...item }) => ({
          ...item,
          ...(await imagesOf(item.investorOrganisationId)),
        })),
      );
      void reply.header("Cache-Control", "no-store");
      return DiscoveryInvestorSlateDtoSchema.parse({
        rankingVersion: slate.rankingVersion,
        items,
        notes: slate.notes,
        nextCursor: slate.nextCursor,
      });
    },
  );

  // One investor, as this founder may see them (ADR 0023). Not visible and
  // absent are the same 404.
  app.get(
    DISCOVERY_INVESTOR_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const raw = (request.params as { investorOrganisationId?: unknown })
        .investorOrganisationId;
      const investor = await service.findInvestor(
        getActorContext(request),
        typeof raw === "string" ? raw : "",
      );
      void reply.header("Cache-Control", "no-store");
      if (investor === null) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      return DiscoveredInvestorProfileDtoSchema.parse({
        ...investor,
        ...(await imagesOf(investor.investorOrganisationId)),
      });
    },
  );

  // An investor's logo alone, for a Q investor reference: only where this
  // reader may see the investor's name (the profile read above, or their
  // own organisation). Every "no" is the same 404.
  app.get(
    DISCOVERY_INVESTOR_PHOTO_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const raw = (request.params as { investorOrganisationId?: unknown })
        .investorOrganisationId;
      const id = typeof raw === "string" ? raw : "";
      void reply.header("Cache-Control", "no-store");
      const named =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          id,
        ) &&
        (actor.organisationId === id ||
          (await service.findInvestor(actor, id).catch(() => null)) !== null);
      if (!named) {
        const problem = createProblemDetails({
          code: "RESOURCE_NOT_FOUND",
          requestId: request.id,
        });
        return reply
          .status(problem.status)
          .type(PROBLEM_CONTENT_TYPE)
          .send(problem);
      }
      const subject = {
        subjectType: "INVESTOR_ORGANISATION" as const,
        subjectId: id,
      };
      const photo = await photoLookup(dependencies.namedPhotos, [subject]);
      return DiscoveredInvestorPhotoDtoSchema.parse({
        photoUrl: photo(subject),
      });
    },
  );
}
