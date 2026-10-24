import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  DiscoveryInvestorSlateDtoSchema,
  type PublicCardDto,
} from "@capital-q/contracts";
import type { DiscoveryService } from "@capital-q/discovery";
import type { PublicIdentityService } from "@capital-q/public-identity";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import {
  publishedFitOf,
  type FounderFacts,
} from "@capital-q/investor-onboarding";

/**
 * QO-42 (owner QA 2026-10-23): a founder saw "not known yet" for stage,
 * sector and geography beside an investor whose Q Card named all three.
 * What the card PUBLISHES (participant audience) is now compared with the
 * founder's own declared company; never the investor's mandate.
 */

const FINTECH = "eacf7107-9af3-5b76-91a2-3c169e396347";
const PAYMENTS = "be80ab01-de8e-524e-86ed-d41ddb88ca7f";
const DIGITAL_HEALTH = "7c953fc5-a6bc-5014-afef-068150e5209a";
const HEALTHCARE = "e79290bb-1839-5433-b458-669edfd33f1e";

function card(fields: Record<string, string>): PublicCardDto {
  return {
    kind: "CARD",
    handle: "northbound",
    subjectType: "INVESTOR_ORGANISATION",
    name: "Northbound Capital (fictional)",
    fields: Object.entries(fields).map(([key, value]) => ({
      key: key as PublicCardDto["fields"][number]["key"],
      value,
      scope: "network_visible" as const,
    })),
    verified: [],
    demoAttested: [],
    audience: "PARTICIPANT",
    indexable: false,
  };
}

const PAYMENTS_IN_LAGOS: FounderFacts = {
  stageCode: "seed",
  headquartersCountry: "NG",
  classifications: [{ nodeId: PAYMENTS, ancestorNodeIds: [FINTECH] }],
};

describe("publishedFitOf", () => {
  it("meets on a published stage, an ancestor sector and a region above their country", () => {
    expect(
      publishedFitOf(
        card({
          mandateStages: "Pre-seed; Seed",
          mandateSectors: "Fintech",
          mandateGeographies: "West Africa",
        }),
        PAYMENTS_IN_LAGOS,
      ),
    ).toEqual({ stage: "MET", sector: "MET", geography: "MET" });
  });

  it("is a no only where every published name was understood and none fits", () => {
    expect(
      publishedFitOf(
        card({
          mandateStages: "Series B",
          mandateSectors: "Healthcare",
          mandateGeographies: "Kenya",
        }),
        PAYMENTS_IN_LAGOS,
      ),
    ).toEqual({ stage: "NOT_MET", sector: "NOT_MET", geography: "NOT_MET" });
  });

  it("Global fits anywhere; a name the taxonomy does not know is not a no", () => {
    expect(
      publishedFitOf(
        card({
          mandateGeographies: "Global",
          mandateSectors: "Healthcare; Climate-adjacent things",
        }),
        PAYMENTS_IN_LAGOS,
      ),
    ).toEqual({ stage: "UNKNOWN", sector: "UNKNOWN", geography: "MET" });
  });

  it("unknown stays unknown: nothing published, no card, or nothing declared", () => {
    const unknown = {
      stage: "UNKNOWN",
      sector: "UNKNOWN",
      geography: "UNKNOWN",
    };
    expect(publishedFitOf(card({}), PAYMENTS_IN_LAGOS)).toEqual(unknown);
    expect(publishedFitOf(null, PAYMENTS_IN_LAGOS)).toEqual(unknown);
    expect(
      publishedFitOf(
        card({
          mandateStages: "Seed",
          mandateSectors: "Healthcare",
          mandateGeographies: "Africa",
        }),
        { stageCode: null, headquartersCountry: null, classifications: [] },
      ),
    ).toEqual(unknown);
    // A company in digital health under a card for healthcare: met.
    expect(
      publishedFitOf(card({ mandateSectors: "Healthcare" }), {
        ...PAYMENTS_IN_LAGOS,
        classifications: [
          { nodeId: DIGITAL_HEALTH, ancestorNodeIds: [HEALTHCARE] },
        ],
      }).sector,
    ).toBe("MET");
  });
});

// --- the slate route ---------------------------------------------------------

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
const INVESTOR = "a1000000-0000-4000-8000-000000000001";

const security: ApiSecurityDependencies = {
  authenticator: {
    authenticate: () =>
      Promise.resolve({
        authUserId: AuthUserIdSchema.parse(
          "a0000000-0000-4000-8000-000000000001",
        ),
      }),
  },
  resolver: {
    resolveHumanContext: () =>
      Promise.resolve({ status: "RESOLVED", context: CONTEXT }),
  },
  identities: { lookup: () => Promise.resolve(null) },
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function build(
  founderFacts?: (actor: ActorContext) => Promise<FounderFacts | null>,
) {
  const askedFor: string[] = [];
  const discovery: DiscoveryService = {
    discoverCompanies: notUnderTest,
    discoverInvestors: () =>
      Promise.resolve({
        rankingVersion: "test",
        items: [
          {
            rank: 1,
            investorOrganisationId: INVESTOR,
            displayName: "Northbound Capital (fictional)",
            investorType: "VC",
            websiteUrl: null,
            hqCountry: "NG",
            publicDescription: null,
            deploymentState: null,
            reasons: [],
          },
        ],
        notes: [],
        nextCursor: null,
      } as unknown as Awaited<
        ReturnType<DiscoveryService["discoverInvestors"]>
      >),
    findInvestor: notUnderTest,
    sideFor: () => Promise.resolve("FOUNDER"),
  };
  const publicIdentity: PublicIdentityService = {
    getCard: notUnderTest,
    claimHandle: notUnderTest,
    updateCard: notUnderTest,
    handleAvailable: notUnderTest,
    resolveHandle: notUnderTest,
    resolveCode: notUnderTest,
    cardPhotoFor: notUnderTest,
    cardImagesFor: notUnderTest,
    cardForSubject: (input) => {
      askedFor.push(input.audience);
      return Promise.resolve(
        card({ mandateStages: "Seed", mandateGeographies: "Kenya" }),
      );
    },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    discovery: {
      discovery,
      slates: { pageCompanies: notUnderTest },
      ...(founderFacts === undefined ? {} : { founderFacts }),
    },
    publicIdentity,
  });
  return { app, askedFor };
}

describe("GET /v1/discovery/investors with what each card publishes", () => {
  it("carries each investor's published fit for the founder's own company, read at the participant audience", async () => {
    const asked: ActorContext[] = [];
    const { app, askedFor } = build((actor) => {
      asked.push(actor);
      return Promise.resolve(PAYMENTS_IN_LAGOS);
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/investors",
    });
    expect(response.statusCode).toBe(200);
    expect(
      DiscoveryInvestorSlateDtoSchema.parse(response.json()).items[0]
        ?.publishedFit,
    ).toEqual({
      stage: "MET",
      sector: "UNKNOWN",
      geography: "NOT_MET",
    });
    // The server-resolved actor, never a client-supplied company.
    expect(asked.map((actor) => actor.organisationId)).toEqual([
      CONTEXT.organisationId,
    ]);
    expect(askedFor).toEqual(["PARTICIPANT"]);
  });

  it("sends no published fit to a reader with no company of their own", async () => {
    const { app, askedFor } = build(() => Promise.resolve(null));
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/investors",
    });
    expect(response.statusCode).toBe(200);
    expect(
      DiscoveryInvestorSlateDtoSchema.parse(response.json()).items[0],
    ).not.toHaveProperty("publishedFit");
    expect(askedFor).toEqual([]);
  });
});
