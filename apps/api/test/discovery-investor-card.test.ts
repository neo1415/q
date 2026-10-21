import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import type { PublicCardDto } from "@capital-q/contracts";
import type { DiscoveryService } from "@capital-q/discovery";
import type {
  CardAudience,
  PublicIdentityService,
  QCardSubject,
} from "@capital-q/public-identity";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * A founder's investor page reads the investor's Q Card by id (brief 2,
 * investor profile). Only for an investor the discovery service already
 * lets this founder see, and then only the card's participant projection:
 * an investor they may not see is the same 404 and no card is ever read.
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
const VISIBLE = "a1000000-0000-4000-8000-000000000001";
const HIDDEN = "a1000000-0000-4000-8000-000000000002";

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

const CARD: PublicCardDto = {
  kind: "CARD",
  handle: "northbound",
  subjectType: "INVESTOR_ORGANISATION",
  name: "Northbound Capital (fictional)",
  fields: [
    { key: "mandateStages", value: "Seed; Series A", scope: "network_visible" },
  ],
  verified: [],
  demoAttested: [],
  audience: "PARTICIPANT",
  indexable: false,
};

function build() {
  const asked: { subject: QCardSubject; audience: CardAudience }[] = [];
  const discovery: DiscoveryService = {
    discoverCompanies: notUnderTest,
    discoverInvestors: notUnderTest,
    findInvestor: (_actor, id) =>
      id === VISIBLE
        ? Promise.resolve({
            investorOrganisationId: VISIBLE,
          } as unknown as Awaited<ReturnType<DiscoveryService["findInvestor"]>>)
        : Promise.resolve(null),
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
      asked.push(input);
      return Promise.resolve(CARD);
    },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    discovery: { discovery, slates: { pageCompanies: notUnderTest } },
    publicIdentity,
  });
  return { app, asked };
}

describe("an investor's Q Card, read by id for a founder", () => {
  it("answers the participant projection for an investor the founder may see", async () => {
    const { app, asked } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/discovery/investors/${VISIBLE}/card`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ card: CARD });
    expect(asked).toEqual([
      {
        subject: { subjectType: "INVESTOR_ORGANISATION", subjectId: VISIBLE },
        audience: "PARTICIPANT",
      },
    ]);
  });

  it("is the same 404 for an investor the founder may not see, and reads no card", async () => {
    const { app, asked } = build();
    for (const id of [HIDDEN, "not-a-uuid"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/discovery/investors/${id}/card`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("mandateStages");
    }
    expect(asked).toEqual([]);
  });
});
