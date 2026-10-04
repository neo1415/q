import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  DISCOVERY_COMPANIES_PATH,
  NO_DISCOVER_FILTERS,
} from "@capital-q/contracts";
import {
  InteractionStateSchema,
  SlateCursorRejectedError,
  type DiscoveryService,
  type InteractionSignalService,
  type PageCompaniesQuery,
  type SlatePage,
  type SlateReadService,
} from "@capital-q/discovery";
import type {
  DiscoverablePitchSet,
  DiscoverablePitchQueryPort,
} from "@capital-q/media";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `GET /v1/discovery/companies` over the persisted slate (CQ-REC-006): the
 * handler passes the actor, limit and cursor through, maps the page to the
 * DTO with the declared card and bounded codes only, and turns a rejected
 * cursor into a 400 with no hint about whose slate it was.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const SLATE = "55555555-0000-4000-8000-000000000001";
const COMPANY = "44444444-0000-4000-8000-000000000001";

const notUnderTest = () => Promise.reject(new Error("not under test"));
const discovery: DiscoveryService = {
  discoverCompanies: notUnderTest,
  discoverInvestors: notUnderTest,
  findInvestor: notUnderTest,
  sideFor: () => Promise.resolve("INVESTOR"),
};

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly page: SlatePage | Error;
  readonly pitches?: DiscoverablePitchQueryPort | undefined;
  readonly saved?: readonly string[] | Error | undefined;
  readonly network?:
    | Pick<
        NonNullable<NonNullable<Parameters<typeof createApp>[2]>["discovery"]>,
        "networkPitches" | "networkCompany" | "yourCompanies" | "mayPlay"
      >
    | undefined;
  readonly feedSummaries?:
    | NonNullable<
        NonNullable<Parameters<typeof createApp>[2]>["discovery"]
      >["feedSummaries"]
    | undefined;
}): { readonly app: FastifyInstance; readonly queries: PageCompaniesQuery[] } {
  const queries: PageCompaniesQuery[] = [];
  const slates: SlateReadService = {
    pageCompanies: (query) => {
      queries.push(query);
      return options.page instanceof Error
        ? Promise.reject(options.page)
        : Promise.resolve(options.page);
    },
  };
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    discovery: {
      discovery,
      slates,
      ...(options.pitches === undefined ? {} : { pitches: options.pitches }),
      ...(options.saved === undefined
        ? {}
        : { interactions: fakeInteractions(options.saved) }),
      ...(options.network ?? {}),
      ...(options.feedSummaries === undefined
        ? {}
        : { feedSummaries: options.feedSummaries }),
    },
  });
  return { app, queries };
}

const STATE_BASE = {
  saved: false,
  savedAt: null,
  passed: false,
  passedAt: null,
  lastPassReason: null,
  impressionCount: 0,
  lastImpressionAt: null,
  lastInteractionAt: null,
};

function fakeInteractions(
  saved: readonly string[] | Error,
): InteractionSignalService {
  const refuse = () => Promise.reject(new Error("not used here"));
  return {
    decide: refuse,
    observe: refuse,
    savedCompanyIds: () => Promise.resolve([]),
    passedCompanyIds: () => Promise.resolve([]),
    stateForCompanies: ({ companyIds }) =>
      saved instanceof Error
        ? Promise.reject(saved)
        : Promise.resolve(
            new Map(
              companyIds
                .filter((id) => saved.includes(id))
                .map((id) => [
                  id,
                  InteractionStateSchema.parse({
                    ...STATE_BASE,
                    companyId: id,
                    saved: true,
                  }),
                ]),
            ),
          ),
  };
}

const PAGE: SlatePage = {
  slateId: SLATE,
  rankingVersion: "ranking-config.v1",
  items: [
    {
      companyId: COMPANY,
      canonicalName: "KoboLogistics",
      websiteUrl: "https://kobo.example",
      headquartersCountry: "NG",
      currentStageCode: "seed",
      shortDescription: "Logistics workflow SaaS.",
      reasonCodes: ["STAGE_ALIGNED", "TAXONOMY_EXACT"],
      unverifiedExclusions: ["stage"],
    },
  ],
  notes: [],
  nextCursor: "eyJ2IjoxfQ",
  unverifiableExclusions: ["red_flag"],
  excludingRules: [],
  discoverableCount: null,
};

describe("GET /v1/discovery/companies (persisted slates)", () => {
  it("serves a page from the persisted slate: actor, limit and cursor pass through; the DTO carries the card and codes only", async () => {
    const { app, queries } = buildApp({ principal: PRINCIPAL, page: PAGE });
    const response = await app.inject({
      method: "GET",
      url: `${DISCOVERY_COMPANIES_PATH}?limit=5&cursor=abc`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(queries).toEqual([
      {
        actor: CONTEXT,
        limit: 5,
        cursor: "abc",
        filters: NO_DISCOVER_FILTERS,
      },
    ]);
    expect(response.json()).toEqual({
      slateId: SLATE,
      rankingVersion: "ranking-config.v1",
      items: [
        {
          companyId: COMPANY,
          canonicalName: "KoboLogistics",
          websiteUrl: "https://kobo.example",
          headquartersCountry: "NG",
          currentStageCode: "seed",
          shortDescription: "Logistics workflow SaaS.",
          reasons: [],
          reasonCodes: ["STAGE_ALIGNED", "TAXONOMY_EXACT"],
          unverifiedExclusions: ["stage"],
          pitch: null,
        },
      ],
      notes: [],
      nextCursor: "eyJ2IjoxfQ",
      unverifiableExclusions: ["red_flag"],
      excludingRules: [],
      discoverableCount: null,
    });
    await app.close();
  });

  it("an empty refreshing page is 200 with the note and no slate id", async () => {
    const { app, queries } = buildApp({
      principal: PRINCIPAL,
      page: {
        slateId: null,
        rankingVersion: "ranking-config.v1",
        items: [],
        notes: ["RECOMMENDATIONS_REFRESHING"],
        nextCursor: null,
        unverifiableExclusions: [],
        excludingRules: [],
        discoverableCount: null,
      },
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(queries).toEqual([
      {
        actor: CONTEXT,
        limit: undefined,
        cursor: null,
        filters: NO_DISCOVER_FILTERS,
      },
    ]);
    expect(response.json()).toMatchObject({
      slateId: null,
      items: [],
      notes: ["RECOMMENDATIONS_REFRESHING"],
      nextCursor: null,
    });
    await app.close();
  });

  it("a rejected cursor is a 400 problem that names no slate", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: new SlateCursorRejectedError(),
    });
    const response = await app.inject({
      method: "GET",
      url: `${DISCOVERY_COMPANIES_PATH}?cursor=${encodeURIComponent("someone-elses")}`,
    });
    expect(response.statusCode).toBe(400);
    const problem: { code?: string; detail?: string } = response.json();
    expect(problem.code).toBe("INVALID_REQUEST");
    expect(JSON.stringify(problem)).not.toContain(SLATE);
    await app.close();
  });

  it("requires an authenticated actor", async () => {
    const { app, queries } = buildApp({ principal: null, page: PAGE });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(401);
    expect(queries).toEqual([]);
    await app.close();
  });
});

// CQ-MEDIA-012: the feed item carries its company's publishable pitch. The
// media port is a double; what is proven here is the boundary: one batched
// call with exactly the page's company ids, the DTO's pitch shape and
// nothing more, null for a company the port did not return, and no call at
// all for an empty page.
describe("GET /v1/discovery/companies — Discover filters (ux/discover-filters)", () => {
  const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";

  it("parses the filter parameters and hands them to the reader, canonically", async () => {
    const { app, queries } = buildApp({ principal: PRINCIPAL, page: PAGE });
    const response = await app.inject({
      method: "GET",
      url: `${DISCOVERY_COMPANIES_PATH}?sector=${FINTECH}&country=ng&stage=seed&raiseMin=100000&raiseCurrency=USD&verifiedOnly=true&hasPitch=true&cursor=abc`,
    });
    expect(response.statusCode).toBe(200);
    expect(queries[0]?.filters).toEqual({
      sectorNodeIds: [FINTECH],
      stageCodes: ["seed"],
      countryCodes: ["NG"],
      raise: { min: "100000", currency: "USD" },
      raiseDisclosedOnly: false,
      verifiedOnly: true,
      hasPitch: true,
    });
    expect(queries[0]?.cursor).toBe("abc");
    await app.close();
  });

  it("a malformed filter is refused (422), never a silently wider feed", async () => {
    const { app, queries } = buildApp({ principal: PRINCIPAL, page: PAGE });
    for (const query of [
      "raiseMin=100",
      "sector=fintech",
      "raiseMin=1e6&raiseCurrency=USD",
      "verifiedOnly=yes",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `${DISCOVERY_COMPANIES_PATH}?${query}`,
      });
      expect(response.statusCode, query).toBe(422);
    }
    expect(queries).toEqual([]);
    await app.close();
  });

  it("says which filters a card could not be checked against", async () => {
    const first = PAGE.items[0];
    if (first === undefined) throw new Error("fixture");
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: {
        ...PAGE,
        items: [{ ...first, filterUnknown: ["raise"] }],
      },
    });
    const response = await app.inject({
      method: "GET",
      url: `${DISCOVERY_COMPANIES_PATH}?raiseMax=500000&raiseCurrency=USD`,
    });
    const body: { items: { filterUnknown?: string[] }[] } = response.json();
    expect(body.items[0]?.filterUnknown).toEqual(["raise"]);
    await app.close();
  });
});

describe("GET /v1/discovery/companies — the viewer's saved state (R30 #7)", () => {
  it("marks each item with the viewer's own saved state", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: PAGE,
      saved: [COMPANY],
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { viewerSaved?: boolean }[] }>();
    expect(body.items[0]?.viewerSaved).toBe(true);
    await app.close();
  });

  it("serves the page without the mark when the state cannot be read", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: PAGE,
      saved: new Error("down"),
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { viewerSaved?: boolean }[] }>();
    expect(body.items[0]?.viewerSaved).toBeUndefined();
    await app.close();
  });
});

describe("GET /v1/discovery/companies — the feed item's pitch", () => {
  const OTHER = "44444444-0000-4000-8000-000000000002";
  const FOREIGN = "44444444-0000-4000-8000-000000000003";
  const MEDIA_ASSET = "f0000000-0000-4000-8000-000000000001";

  const first = PAGE.items[0];
  if (first === undefined) throw new Error("fixture");
  const twoItemPage: SlatePage = {
    ...PAGE,
    items: [
      first,
      {
        companyId: OTHER,
        canonicalName: "Other Co",
        websiteUrl: null,
        headquartersCountry: null,
        currentStageCode: null,
        shortDescription: null,
        reasonCodes: [],
        unverifiedExclusions: [],
      },
    ],
  };

  function fakePitches(answer: ReadonlyMap<string, DiscoverablePitchSet>): {
    readonly port: DiscoverablePitchQueryPort;
    readonly calls: string[][];
  } {
    const calls: string[][] = [];
    const port: DiscoverablePitchQueryPort = {
      findDiscoverablePitches: (companyIds) => {
        calls.push([...companyIds]);
        return Promise.resolve(answer);
      },
    };
    return { port, calls };
  }

  it("asks the media port once for the page's companies and places each pitch on its item", async () => {
    const { port, calls } = fakePitches(
      new Map<string, DiscoverablePitchSet>([
        [
          COMPANY,
          {
            mediaAssetId: MEDIA_ASSET as DiscoverablePitchSet["mediaAssetId"],
            companyId: COMPANY,
            aspectRatio: "9:16",
            durationSeconds: 87,
            captionState: "NOT_REQUESTED",
            title: null,
            audience: "INVESTORS",
            downloadable: false,
            more: [],
          },
        ],
        // The port answers for a company that is not on this page: the
        // route places nothing it was not asked about.
        [
          FOREIGN,
          {
            mediaAssetId:
              "f0000000-0000-4000-8000-000000000009" as DiscoverablePitchSet["mediaAssetId"],
            companyId: FOREIGN,
            aspectRatio: null,
            durationSeconds: null,
            captionState: "NOT_REQUESTED",
            title: null,
            audience: "INVESTORS",
            downloadable: false,
            more: [],
          },
        ],
      ]),
    );
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: twoItemPage,
      pitches: port,
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([[COMPANY, OTHER]]);
    const body = response.json<{
      items: { companyId: string; pitch: unknown }[];
    }>();
    expect(body.items.map((item) => item.companyId)).toEqual([COMPANY, OTHER]);
    // Exactly the contract's fields: no companyId echo, no status, no
    // provider id, no URL.
    expect(body.items[0]?.pitch).toEqual({
      mediaAssetId: MEDIA_ASSET,
      aspectRatio: "9:16",
      durationSeconds: 87,
      captionState: "NOT_REQUESTED",
      title: null,
      downloadAllowed: false,
    });
    expect(body.items[1]?.pitch).toBeNull();
    expect(response.payload).not.toContain(FOREIGN);
    await app.close();
  });

  it("places each card's summary as the composed read answered it, and an unknown raise stays null (Discover v2)", async () => {
    const asked: string[][] = [];
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: twoItemPage,
      feedSummaries: (_actor, companyIds) => {
        asked.push([...companyIds]);
        return Promise.resolve(
          new Map([
            [
              COMPANY,
              {
                sectorNodeIds: ["a0000000-0000-4000-8000-000000000001"],
                raise: {
                  money: { amount: "1500000", currency: "USD" },
                  truthClass: "USER_CLAIM" as const,
                  evidenceStatus: "SELF_REPORTED" as const,
                },
              },
            ],
            // Not shared with this reader: unknown, never zero.
            [OTHER, { sectorNodeIds: [], raise: null }],
          ]),
        );
      },
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(asked).toEqual([[COMPANY, OTHER]]);
    const body = response.json<{
      items: { summary?: { raise: unknown; sectorNodeIds: string[] } }[];
    }>();
    expect(body.items[0]?.summary?.raise).toEqual({
      money: { amount: "1500000", currency: "USD" },
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    });
    expect(body.items[1]?.summary).toEqual({ sectorNodeIds: [], raise: null });
    await app.close();
  });

  it("a failing summary read leaves cards without a summary, never a guessed one", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: twoItemPage,
      feedSummaries: () => Promise.reject(new Error("disclosure down")),
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { summary?: unknown }[] }>();
    expect(body.items.every((item) => item.summary === undefined)).toBe(true);
    await app.close();
  });

  it("leaves every pitch null when the port returns nothing, and asks nothing for an empty page", async () => {
    const empty = fakePitches(new Map());
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: twoItemPage,
      pitches: empty.port,
    });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(
      response
        .json<{ items: { pitch: unknown }[] }>()
        .items.map((item) => item.pitch),
    ).toEqual([null, null]);
    expect(empty.calls).toHaveLength(1);
    await app.close();

    const untouched = fakePitches(new Map());
    const { app: emptyApp } = buildApp({
      principal: PRINCIPAL,
      page: { ...PAGE, items: [], nextCursor: null },
      pitches: untouched.port,
    });
    const none = await emptyApp.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(none.statusCode).toBe(200);
    expect(untouched.calls).toHaveLength(0);
    await emptyApp.close();
  });

  it("is a feed without video when no port is composed", async () => {
    const { app } = buildApp({ principal: PRINCIPAL, page: twoItemPage });
    const response = await app.inject({
      method: "GET",
      url: DISCOVERY_COMPANIES_PATH,
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json<{ items: { pitch: unknown }[] }>()
        .items.map((item) => item.pitch),
    ).toEqual([null, null]);
    await app.close();
  });
});

describe("GET /v1/discovery/network-pitches (ADR 0021)", () => {
  const video = (n: number, companyId: string) => ({
    mediaAssetId:
      `f0000000-0000-4000-8000-00000000010${String(n)}` as DiscoverablePitchSet["mediaAssetId"],
    companyId,
    aspectRatio: "9:16",
    durationSeconds: 40,
    captionState: "NOT_REQUESTED" as const,
    title: `Video ${String(n)}`,
    audience: "NETWORK" as const,
    createdAt: `2026-09-2${String(9 - n)}T10:00:00.000Z`,
  });
  const VISIBLE = "c1000000-0000-4000-8000-000000000001";
  const HIDDEN = "c1000000-0000-4000-8000-000000000002";
  const CLOSED = "c1000000-0000-4000-8000-000000000003";

  it("returns only companies disclosure lets this viewer see, newest first, with a cursor that pages", async () => {
    const asked: unknown[] = [];
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: new Error("not used"),
      network: {
        networkPitches: {
          findNetworkPitches: (input) => {
            asked.push(input);
            return Promise.resolve([
              video(1, VISIBLE),
              video(2, HIDDEN),
              video(3, CLOSED),
            ]);
          },
        },
        networkCompany: (_actor, companyId) =>
          Promise.resolve(
            companyId === HIDDEN
              ? null
              : {
                  canonicalName: companyId === VISIBLE ? "Open Co" : "Gone Co",
                  shortDescription: null,
                  headquartersCountry: "NG",
                  currentStageCode: "seed",
                  companyStatus: companyId === VISIBLE ? "active" : "closed",
                },
          ),
      },
    });
    const first = await app.inject({
      method: "GET",
      url: "/v1/discovery/network-pitches?limit=3",
    });
    expect(first.statusCode).toBe(200);
    const body = first.json<{
      items: { companyId: string; canonicalName: string }[];
      nextCursor: string | null;
    }>();
    expect(body.items.map((i) => i.canonicalName)).toEqual(["Open Co"]);
    expect(body.nextCursor).not.toBeNull();
    expect(asked[0]).toMatchObject({
      excludeOwnerOrganisationId: CONTEXT.organisationId,
      before: null,
      limit: 3,
    });

    await app.inject({
      method: "GET",
      url: `/v1/discovery/network-pitches?limit=3&cursor=${body.nextCursor ?? ""}`,
    });
    expect(asked[1]).toMatchObject({
      before: {
        createdAt: video(3, CLOSED).createdAt,
        mediaAssetId: video(3, CLOSED).mediaAssetId,
      },
    });

    const bad = await app.inject({
      method: "GET",
      url: "/v1/discovery/network-pitches?cursor=not-a-cursor",
    });
    expect(bad.statusCode).toBe(422);
    await app.close();
  });

  it("searches what the network shows, never what disclosure hid", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: new Error("not used"),
      network: {
        networkPitches: {
          findNetworkPitches: () =>
            Promise.resolve([video(1, VISIBLE), video(2, HIDDEN)]),
        },
        networkCompany: (_actor, companyId) =>
          Promise.resolve(
            companyId === HIDDEN
              ? null
              : {
                  canonicalName: "Open Co",
                  shortDescription: "Freight booking in Lagos",
                  headquartersCountry: "NG",
                  currentStageCode: "seed",
                  companyStatus: "active",
                },
          ),
      },
    });
    const byDescription = await app.inject({
      method: "GET",
      url: "/v1/discovery/network-pitches?q=FREIGHT",
    });
    expect(
      byDescription.json<{ items: { canonicalName: string }[] }>().items,
    ).toHaveLength(1);
    const none = await app.inject({
      method: "GET",
      url: "/v1/discovery/network-pitches?q=hidden",
    });
    expect(none.json()).toEqual({ items: [], nextCursor: null });
    await app.close();
  });

  it("is an empty page when the feed is not composed", async () => {
    const { app } = buildApp({ principal: PRINCIPAL, page: new Error("x") });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/network-pitches",
    });
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    await app.close();
  });
});

describe("GET /v1/discovery/your-companies (founder decisions 2026-10-02, 2026-10-04)", () => {
  const NIXO = "c2000000-0000-4000-8000-000000000001";
  const SAVED = "c2000000-0000-4000-8000-000000000002";
  const HIDDEN = "c2000000-0000-4000-8000-000000000003";
  const NO_PITCH = "c2000000-0000-4000-8000-000000000004";
  const REFUSED = "c2000000-0000-4000-8000-000000000005";
  const set = (n: number, companyId: string): DiscoverablePitchSet => ({
    mediaAssetId:
      `f0000000-0000-4000-8000-00000000020${String(n)}` as DiscoverablePitchSet["mediaAssetId"],
    companyId,
    aspectRatio: "9:16",
    durationSeconds: 40,
    captionState: "NOT_REQUESTED",
    title: null,
    audience: "INVESTORS",
    downloadable: false,
    more: [],
  });
  const pitches: DiscoverablePitchQueryPort = {
    findDiscoverablePitches: () =>
      Promise.resolve(
        new Map([
          [NIXO, set(1, NIXO)],
          [SAVED, set(2, SAVED)],
          [HIDDEN, set(3, HIDDEN)],
          [REFUSED, set(5, REFUSED)],
        ]),
      ),
    latestReadyAt: () =>
      Promise.resolve(
        new Map([
          [NIXO, "2026-10-02T08:04:06.000Z"],
          [SAVED, "2026-09-20T10:00:00.000Z"],
          [HIDDEN, "2026-10-01T10:00:00.000Z"],
          // Newest of all, yet never listed: the player would refuse it.
          [REFUSED, "2026-10-02T09:00:00.000Z"],
        ]),
      ),
  };

  it("every company of theirs, most recent activity first, labelled, disclosure re-checked; a pitch only when it will play, else 'not shared'; cursor-paged (follow-55)", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: new Error("not used"),
      pitches,
      network: {
        yourCompanies: () =>
          Promise.resolve([
            {
              companyId: SAVED,
              label: "SAVED" as const,
              activityAt: "2026-09-20T10:00:00.000Z",
            },
            // Connected, a meeting held yesterday: the latest activity.
            {
              companyId: NIXO,
              label: "CONNECTED" as const,
              activityAt: "2026-10-03T09:48:33.414Z",
            },
            {
              companyId: HIDDEN,
              label: "INTERESTED" as const,
              activityAt: "2026-10-02T10:00:00.000Z",
            },
            {
              companyId: NO_PITCH,
              label: "CONNECTED" as const,
              activityAt: "2026-10-01T10:00:00.000Z",
            },
            {
              companyId: REFUSED,
              label: "INTERESTED" as const,
              activityAt: "2026-09-30T10:00:00.000Z",
            },
          ]),
        // The player's own rule: REFUSED's pitch would not be signed.
        mayPlay: (_actor, companyId) => Promise.resolve(companyId !== REFUSED),
        networkCompany: (_actor, companyId) =>
          Promise.resolve(
            companyId === HIDDEN
              ? null
              : {
                  canonicalName: companyId === NIXO ? "Nixo" : "Other Co",
                  shortDescription: null,
                  headquartersCountry: "NG",
                  currentStageCode: "seed",
                  companyStatus: "active",
                },
          ),
      },
    });
    const first = await app.inject({
      method: "GET",
      url: "/v1/discovery/your-companies?limit=1",
    });
    expect(first.statusCode).toBe(200);
    const page1 = first.json<{
      items: {
        companyId: string;
        label: string;
        canonicalName: string;
        pitch: unknown;
        activityAt: string;
      }[];
      nextCursor: string | null;
    }>();
    expect(page1.items).toMatchObject([
      {
        companyId: NIXO,
        label: "CONNECTED",
        canonicalName: "Nixo",
        activityAt: "2026-10-03T09:48:33.414Z",
        pitch: { mediaAssetId: "f0000000-0000-4000-8000-000000000201" },
      },
    ]);
    expect(page1.nextCursor).not.toBeNull();
    const rest = await app.inject({
      method: "GET",
      url: `/v1/discovery/your-companies?limit=5&cursor=${page1.nextCursor ?? ""}`,
    });
    const page2 = rest.json<{
      items: { companyId: string; label: string; pitch: unknown }[];
      nextCursor: string | null;
    }>();
    // The hidden company drops out. The one without a pitch, and the one
    // whose pitch would not be signed for them, stay: "Pitch not shared".
    expect(
      page2.items.map((item) => [
        item.companyId,
        item.label,
        item.pitch === null,
      ]),
    ).toEqual([
      [NO_PITCH, "CONNECTED", true],
      [REFUSED, "INTERESTED", true],
      [SAVED, "SAVED", false],
    ]);
    expect(page2.nextCursor).toBeNull();
    await app.close();
  });

  it("is empty for someone with no companies of their own", async () => {
    const { app } = buildApp({
      principal: PRINCIPAL,
      page: new Error("not used"),
      pitches,
      network: {
        yourCompanies: () => Promise.resolve([]),
        networkCompany: () => Promise.resolve(null),
        mayPlay: () => Promise.resolve(true),
      },
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/your-companies",
    });
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    await app.close();
  });
});
