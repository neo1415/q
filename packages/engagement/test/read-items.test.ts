import { describe, expect, it } from "vitest";

import type {
  CompanyEngagementDto,
  InvestorViewingDto,
} from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { ownEngagementItems } from "../src/index.js";

const actor = {
  userId: UserIdSchema.parse("b0000000-0000-4000-8000-000000000001"),
  tenantId: TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001"),
  organisationId: OrganisationIdSchema.parse(
    "d0000000-0000-4000-8000-000000000001",
  ),
  membershipId: MembershipIdSchema.parse(
    "e0000000-0000-4000-8000-000000000001",
  ),
  actorType: "HUMAN" as const,
};
const COMPANY = "f0000000-0000-4000-8000-000000000001";

const repository = {
  privacyFor: () =>
    Promise.resolve({
      visibility: "ORGANISATION_ONLY" as const,
      chosen: false,
      defaultVisibility: "ORGANISATION_ONLY" as const,
      allowedVisibilities: [
        "FULL_IDENTITY" as const,
        "ORGANISATION_ONLY" as const,
        "ANONYMOUS" as const,
      ],
    }),
};

function engagement(
  patch: Partial<CompanyEngagementDto>,
): CompanyEngagementDto {
  return {
    companyId: COMPANY,
    since: null,
    floorMet: false,
    floor: 3,
    sliceFloor: 5,
    passiveBatch: "WEEKLY",
    perViewer: false,
    entitled: false,
    intent: [],
    periods: [],
    slices: [],
    deckFunnel: [],
    videos: [],
    documents: [],
    viewers: [],
    viewerDeckDetail: [],
    ...patch,
  };
}

describe("Q's read of engagement (A5)", () => {
  it("an investor reads only their own visibility", async () => {
    const items = await ownEngagementItems(
      {
        reader: { read: () => Promise.reject(new Error("not read")) },
        repository,
      },
      actor,
      null,
    );
    expect(items.map((item) => item.id)).toEqual(["viewing-privacy"]);
    expect(items[0]?.status).toContain("their organisation only");
  });

  it("below the floor, a founder hears the floor, never a count of one or two", async () => {
    const items = await ownEngagementItems(
      { reader: { read: () => Promise.resolve(engagement({})) }, repository },
      actor,
      COMPANY,
    );
    const summary = items.find((item) => item.id === "engagement-summary");
    expect(summary?.status).toBe(
      "Fewer than 3 investor organisations viewed; figures appear from 3",
    );
    expect(String(summary?.facts["rule"])).toContain(
      "never suggest contacting someone because they viewed",
    );
  });

  it("words each viewer at the level the projection showed, and nothing more", async () => {
    const base = {
      basis: "VIEWER_CHOICE" as const,
      viewerName: null,
      organisationName: null,
      viewerUserId: null,
      viewerOrganisationId: null,
      organisations: 1,
      people: 1,
      events: 2,
      profileViews: 2,
      deckOpens: 0,
      deckDwellMs: null,
      videoWatchMs: null,
      qCardViews: 0,
      dataRoomDocumentViews: 0,
      lastPeriodStart: "2026-10-19",
    };
    const items = await ownEngagementItems(
      {
        reader: {
          read: () =>
            Promise.resolve(
              engagement({
                floorMet: true,
                perViewer: true,
                entitled: true,
                viewers: [
                  {
                    ...base,
                    visibility: "ORGANISATION_ONLY",
                    viewerOrganisationId:
                      "a1000000-0000-4000-8000-000000000001",
                    organisationName: "Apex Capital",
                  },
                  {
                    ...base,
                    visibility: "ANONYMOUS",
                    organisations: 3,
                    lastPeriodStart: null,
                  },
                ],
              }),
            ),
        },
        repository,
      },
      actor,
      COMPANY,
    );
    const titles = items.map((item) => item.title);
    expect(titles).toContain("Someone from Apex Capital");
    expect(titles).toContain(
      "Investors who chose to stay anonymous (3 organisations)",
    );
    expect(JSON.stringify(items)).not.toMatch(/message|contact them/i);
  });

  it("puts intent first, and reads no viewing when the admin turned that off", async () => {
    const withIntent = engagement({
      floorMet: true,
      intent: [
        {
          type: "INTEREST",
          occurredAt: "2026-11-06T10:00:00.000Z",
          visibility: "ORGANISATION_ONLY",
          viewerUserId: null,
          viewerName: null,
          viewerOrganisationId: "a1000000-0000-4000-8000-000000000001",
          organisationName: "Apex Capital",
        },
      ],
    });
    const on = await ownEngagementItems(
      { reader: { read: () => Promise.resolve(withIntent) }, repository },
      actor,
      COMPANY,
    );
    expect(on[1]).toMatchObject({
      title: "Someone from Apex Capital",
      status: "asked to connect",
    });
    expect(on.some((item) => item.id === "engagement-summary")).toBe(true);
    const off = await ownEngagementItems(
      {
        reader: { read: () => Promise.resolve(withIntent) },
        repository,
        usesPassiveSignals: () => Promise.resolve(false),
      },
      actor,
      COMPANY,
    );
    expect(off.map((item) => item.id)).toEqual([
      "viewing-privacy",
      "intent-INTEREST-2026-11-06T10:00:00.000Z",
    ]);
  });
});

describe("an investor asking who viewed them (owner live test 7 Nov 2026)", () => {
  const viewing = (patch: Partial<InvestorViewingDto> = {}) => ({
    mine: () =>
      Promise.resolve<InvestorViewingDto>({
        investorOrganisationId: "f0000000-0000-4000-8000-0000000000aa",
        since: null,
        floorMet: false,
        floor: 3,
        sliceFloor: 5,
        passiveBatch: "WEEKLY",
        periods: [],
        slices: [],
        ...patch,
      }),
  });
  const mine = {
    read: () =>
      Promise.resolve({
        privacy: {
          visibility: "ORGANISATION_ONLY" as const,
          chosen: false,
          defaultVisibility: "ORGANISATION_ONLY" as const,
          allowedVisibilities: ["ORGANISATION_ONLY" as const],
        },
        viewed: [
          {
            companyId: COMPANY,
            companyName: "Spheros",
            views: 1,
            deckMinutes: 0,
            lastViewedAt: "2026-11-07T10:00:00.000Z",
          },
        ],
        responses: [],
      }),
  };
  const reader = { read: () => Promise.resolve(null) };

  it("answers who viewed the investor, below the floor in words", async () => {
    const items = await ownEngagementItems(
      { reader, repository, mine, investorViewing: viewing() },
      actor,
      null,
    );
    const who = items.find((item) => item.id === "who-viewed-you");
    expect(who?.title).toBe("Founders viewing your profile");
    expect(who?.status).toBe(
      "Fewer than 3 founder organisations viewed your profile in a completed week",
    );
  });

  it("gives the latest completed week once the floor is met, never a name", async () => {
    const items = await ownEngagementItems(
      {
        reader,
        repository,
        mine,
        investorViewing: viewing({
          floorMet: true,
          periods: [
            {
              periodStart: "2026-10-26",
              organisations: 7,
              viewers: 7,
              profileViews: 8,
            },
          ],
        }),
      },
      actor,
      null,
    );
    const who = items.find((item) => item.id === "who-viewed-you");
    expect(who?.status).toBe(
      "7 founder organisations viewed your profile in the week of 2026-10-26 (8 views)",
    );
    expect(JSON.stringify(who)).not.toMatch(
      /contact them|reach out|message them/iu,
    );
    expect(String(who?.facts["rule"])).toMatch(/not permission to contact/u);
  });

  it("labels the investor's own viewing so it cannot answer 'who viewed me'", async () => {
    const items = await ownEngagementItems(
      { reader, repository, mine, investorViewing: viewing() },
      actor,
      null,
    );
    const own = items.find((item) => item.id === `viewed-${COMPANY}`);
    expect(own?.title).toBe("You viewed Spheros");
    expect(own?.status).toBe("your own viewing: 1 view, not who viewed you");
  });
});
