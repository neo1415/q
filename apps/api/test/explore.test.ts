import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  ExplorePageDtoSchema,
  ExploreRelatedDtoSchema,
  ExploreSearchDtoSchema,
} from "@capital-q/contracts";
import {
  createExploreService,
  type DiscoveryService,
  type SlateReadService,
} from "@capital-q/discovery";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import type { ExploreRow } from "../src/http/explore.js";

/**
 * Explore routes (E1-E5, ADR 0055): a signed-in read over the pool the
 * Explore service builds after disclosure. A hidden company's pitch is
 * neither listed, related nor searchable, and nothing on the wire counts.
 */

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

const VISIBLE = "44444444-0000-4000-8000-000000000001";
const PEER = "44444444-0000-4000-8000-000000000002";
const HIDDEN = "44444444-0000-4000-8000-000000000003";

const row = (n: number, companyId: string): ExploreRow => ({
  mediaAssetId:
    `f0000000-0000-4000-8000-00000000010${String(n)}` as ExploreRow["mediaAssetId"],
  companyId,
  aspectRatio: n === 2 ? "16:9" : "9:16",
  durationSeconds: 40,
  captionState: "NOT_REQUESTED",
  title: `Pitch ${String(n)}`,
  audience: "NETWORK",
  downloadable: false,
  createdAt: `2026-10-0${String(n)}T10:00:00.000Z`,
});
const ROWS = [row(1, VISIBLE), row(2, PEER), row(3, HIDDEN)];

const notUnderTest = () => Promise.reject(new Error("not under test"));
const discovery: DiscoveryService = {
  discoverCompanies: notUnderTest,
  discoverInvestors: notUnderTest,
  findInvestor: notUnderTest,
  sideFor: () => Promise.resolve("INVESTOR"),
};
const slates: SlateReadService = { pageCompanies: notUnderTest };

function buildApp(signedIn = true) {
  const security: ApiSecurityDependencies = {
    authenticator: {
      authenticate: () =>
        Promise.resolve(
          signedIn
            ? {
                authUserId: AuthUserIdSchema.parse(
                  "a0000000-0000-4000-8000-000000000001",
                ),
              }
            : null,
        ),
    },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const explore = createExploreService<ExploreRow>({
    findNetworkPitches: (input) =>
      Promise.resolve(input.before === null ? ROWS : []),
    company: (_actor, companyId) =>
      Promise.resolve(
        companyId === HIDDEN
          ? null
          : {
              canonicalName:
                companyId === VISIBLE ? "Kora Health" : "Lumen Labs",
              shortDescription: "Clinic payments",
              headquartersCountry: "NG",
              currentStageCode: "seed",
              companyStatus: "active",
            },
      ),
    clock: () => Date.parse("2026-10-06T12:00:00.000Z"),
  });
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    discovery: { discovery, slates, explore },
  });
  return app;
}

describe("GET /v1/discovery/explore", () => {
  it("refuses a signed-out request", async () => {
    const response = await buildApp(false).inject({
      method: "GET",
      url: "/v1/discovery/explore",
    });
    expect(response.statusCode).toBe(401);
  });

  it("serves only disclosed pitches, each with a reason and no counts", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/discovery/explore?limit=1",
    });
    expect(response.statusCode).toBe(200);
    const page = ExplorePageDtoSchema.parse(response.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.reason).toBe("NEW_THIS_WEEK");
    expect(page.upToDate).toBe(false);
    const body = response.body.toLowerCase();
    for (const word of ["view", "like", "watch", "impression", "score"]) {
      expect(body).not.toContain(word);
    }
    const next = await buildApp().inject({
      method: "GET",
      url: `/v1/discovery/explore?limit=5&cursor=${page.nextCursor ?? ""}`,
    });
    const rest = ExplorePageDtoSchema.parse(next.json());
    expect(rest.upToDate).toBe(true);
    expect(rest.nextCursor).toBeNull();
    const all = [...page.items, ...rest.items].map((i) => i.companyId);
    expect(all.sort()).toEqual([VISIBLE, PEER].sort());
  });

  it("rejects a forged cursor and an unknown mode", async () => {
    const forged = await buildApp().inject({
      method: "GET",
      url: "/v1/discovery/explore?cursor=bm90LWEtY3Vyc29y",
    });
    expect(forged.statusCode).toBe(422);
    const mode = await buildApp().inject({
      method: "GET",
      url: "/v1/discovery/explore?mode=TRENDING",
    });
    expect(mode.statusCode).toBe(422);
  });
});

describe("GET /v1/discovery/explore/related/:mediaAssetId", () => {
  it("returns the anchor then related pitches", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: `/v1/discovery/explore/related/${ROWS[0]?.mediaAssetId ?? ""}`,
    });
    expect(response.statusCode).toBe(200);
    const related = ExploreRelatedDtoSchema.parse(response.json());
    expect(related.anchor.companyId).toBe(VISIBLE);
    expect(related.items.map((i) => i.companyId)).toEqual([PEER]);
    expect(related.items[0]?.related).toEqual(["SAME_STAGE", "SAME_GEOGRAPHY"]);
  });

  it("cross-tenant negative: a hidden company's pitch is not found", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: `/v1/discovery/explore/related/${ROWS[2]?.mediaAssetId ?? ""}`,
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /v1/discovery/explore/search", () => {
  it("matches only what disclosure shows", async () => {
    const response = await buildApp().inject({
      method: "GET",
      url: "/v1/discovery/explore/search?q=clinic",
    });
    const result = ExploreSearchDtoSchema.parse(response.json());
    expect(result.companies.map((c) => c.companyId).sort()).toEqual(
      [VISIBLE, PEER].sort(),
    );
    expect(result.pitches.some((p) => p.companyId === HIDDEN)).toBe(false);
  });
});
