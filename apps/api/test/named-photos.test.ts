import { describe, expect, it } from "vitest";

import type { ScheduleService } from "@capital-q/communication";
import { parseApiConfig } from "@capital-q/config/api";
import type { DiscoveryService } from "@capital-q/discovery";
import {
  namedImageKey,
  type NamedImageSubject,
  type NamedImages,
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
 * A picture has the scope of its name (founder decision 2026-10-04): a
 * response that names a person or organisation to this reader carries
 * their picture, signed in one batch; a reader the response would not name
 * them to gets no picture, and nothing is signed for them.
 */

const OWN_ORG = "d0000000-0000-4000-8000-000000000001";
const CONTEXT: ActorContext = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(OWN_ORG),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN",
};
const VISIBLE_INVESTOR = "a1000000-0000-4000-8000-000000000001";
const HIDDEN_INVESTOR = "a1000000-0000-4000-8000-000000000002";
const COMPANY = "44444444-0000-4000-8000-000000000001";
const LOGO = "https://storage.test/object/sign/cq-profile-images/l?token=t";
const COVER = "https://storage.test/object/sign/cq-profile-images/c?token=t";

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

/** Every subject has a picture; what was asked is recorded. */
function reader() {
  const asked: NamedImageSubject[][] = [];
  const all = (subjects: readonly NamedImageSubject[]) => {
    asked.push([...subjects]);
    return subjects;
  };
  return {
    asked,
    namedPhotos: {
      photos: (subjects: readonly NamedImageSubject[]) =>
        Promise.resolve(
          new Map(all(subjects).map((s) => [namedImageKey(s), LOGO] as const)),
        ),
      images: (subjects: readonly NamedImageSubject[]) =>
        Promise.resolve(
          new Map<string, NamedImages>(
            all(subjects).map((s) => [
              namedImageKey(s),
              { photo: LOGO, cover: COVER },
            ]),
          ),
        ),
    },
  };
}

const notUnderTest = () => Promise.reject(new Error("not under test"));

describe("an investor's logo for a Q reference", () => {
  const discovery: DiscoveryService = {
    discoverCompanies: notUnderTest,
    discoverInvestors: notUnderTest,
    // Only the visible investor is one this founder may see (and name).
    findInvestor: (_actor, id) =>
      id === VISIBLE_INVESTOR
        ? Promise.resolve({
            investorOrganisationId: VISIBLE_INVESTOR,
          } as unknown as Awaited<ReturnType<DiscoveryService["findInvestor"]>>)
        : Promise.resolve(null),
    sideFor: () => Promise.resolve("FOUNDER"),
  };
  const build = () => {
    const { asked, namedPhotos } = reader();
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      discovery: {
        discovery,
        slates: { pageCompanies: notUnderTest },
      },
      namedPhotos,
    });
    return { app, asked };
  };

  it("answers where the reader may see the investor's name", async () => {
    const { app, asked } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/discovery/investors/${VISIBLE_INVESTOR}/photo`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ photoUrl: LOGO });
    expect(asked).toEqual([
      [{ subjectType: "INVESTOR_ORGANISATION", subjectId: VISIBLE_INVESTOR }],
    ]);
  });

  it("answers for the reader's own organisation", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/discovery/investors/${OWN_ORG}/photo`,
    });
    expect(response.json()).toEqual({ photoUrl: LOGO });
  });

  it("is the same 404 for an investor the reader may not name, and signs nothing", async () => {
    const { app, asked } = build();
    for (const id of [HIDDEN_INVESTOR, "not-a-uuid"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/discovery/investors/${id}/photo`,
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("storage.test");
    }
    expect(asked).toEqual([]);
  });
});

describe("notices name who they are about", () => {
  const at = new Date("2026-10-04T09:00:00.000Z");
  const schedule = Object.assign({} as ScheduleService, {
    listNotifications: () =>
      Promise.resolve({
        unread: 2,
        items: [
          {
            id: "70000000-0000-4000-8000-000000000001",
            kind: "INTEREST_RECEIVED" as const,
            title: "Beacon Ventures is interested",
            body: null,
            linkPath: `/relationships/investor/${VISIBLE_INVESTOR}`,
            readAt: null,
            createdAt: at,
          },
          {
            id: "70000000-0000-4000-8000-000000000002",
            kind: "REMINDER" as const,
            title: "Send the deck",
            body: null,
            linkPath: "/documents",
            readAt: null,
            createdAt: at,
          },
        ],
      }),
  });

  it("a notice about the reader's own relationship carries that side's logo; others none", async () => {
    const { asked, namedPhotos } = reader();
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      schedule,
      namedPhotos,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/notifications",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      items: { title: string; named: unknown }[];
    }>();
    expect(body.items.map((item) => item.named)).toEqual([
      {
        kind: "INVESTOR_ORGANISATION",
        id: VISIBLE_INVESTOR,
        photoUrl: LOGO,
      },
      null,
    ]);
    // One batch, and only for the side the notice names.
    expect(asked).toEqual([
      [{ subjectType: "INVESTOR_ORGANISATION", subjectId: VISIBLE_INVESTOR }],
    ]);
  });
});

describe("Your companies", () => {
  it("each card carries its company's logo and cover, from one batch", async () => {
    const { asked, namedPhotos } = reader();
    const discovery: DiscoveryService = {
      discoverCompanies: notUnderTest,
      discoverInvestors: notUnderTest,
      findInvestor: notUnderTest,
      sideFor: () => Promise.resolve("INVESTOR"),
    };
    const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
      discovery: {
        discovery,
        slates: { pageCompanies: notUnderTest },
        pitches: {
          findDiscoverablePitches: () => Promise.resolve(new Map()),
        },
        yourCompanies: () =>
          Promise.resolve([{ companyId: COMPANY, label: "SAVED" as const }]),
        networkCompany: () =>
          Promise.resolve({
            canonicalName: "Kora",
            shortDescription: null,
            headquartersCountry: null,
            currentStageCode: null,
            companyStatus: "active",
          }),
        mayPlay: () => Promise.resolve(false),
      },
      namedPhotos,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/discovery/your-companies",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ companyId: COMPANY, photoUrl: LOGO, coverUrl: COVER }],
    });
    expect(asked).toEqual([[{ subjectType: "COMPANY", subjectId: COMPANY }]]);
  });
});
