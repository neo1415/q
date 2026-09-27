import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import { DISCOVERY_COMPANIES_PATH } from "@capital-q/contracts";
import {
  SlateCursorRejectedError,
  type DiscoveryService,
  type PageCompaniesQuery,
  type SlatePage,
  type SlateReadService,
} from "@capital-q/discovery";
import type {
  DiscoverablePitch,
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
  sideFor: () => Promise.resolve("INVESTOR"),
};

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly page: SlatePage | Error;
  readonly pitches?: DiscoverablePitchQueryPort | undefined;
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
    },
  });
  return { app, queries };
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
    expect(queries).toEqual([{ actor: CONTEXT, limit: 5, cursor: "abc" }]);
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
      { actor: CONTEXT, limit: undefined, cursor: null },
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

  function fakePitches(answer: ReadonlyMap<string, DiscoverablePitch>): {
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
      new Map<string, DiscoverablePitch>([
        [
          COMPANY,
          {
            mediaAssetId: MEDIA_ASSET as DiscoverablePitch["mediaAssetId"],
            companyId: COMPANY,
            aspectRatio: "9:16",
            durationSeconds: 87,
            captionState: "NOT_REQUESTED",
          },
        ],
        // The port answers for a company that is not on this page: the
        // route places nothing it was not asked about.
        [
          FOREIGN,
          {
            mediaAssetId:
              "f0000000-0000-4000-8000-000000000009" as DiscoverablePitch["mediaAssetId"],
            companyId: FOREIGN,
            aspectRatio: null,
            durationSeconds: null,
            captionState: "NOT_REQUESTED",
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
    // Exactly the contract's four fields: no companyId echo, no status, no
    // provider id, no URL.
    expect(body.items[0]?.pitch).toEqual({
      mediaAssetId: MEDIA_ASSET,
      aspectRatio: "9:16",
      durationSeconds: 87,
      captionState: "NOT_REQUESTED",
    });
    expect(body.items[1]?.pitch).toBeNull();
    expect(response.payload).not.toContain(FOREIGN);
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
