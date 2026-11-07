import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  ENGAGEMENT_EVENTS_PATH,
  VIEWING_PRIVACY_PATH,
  type EngagementEventInput,
  type ViewingVisibility,
} from "@capital-q/contracts";
import {
  createEngagementService,
  type EngagementRepository,
  type EngagementViewer,
} from "@capital-q/engagement";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

const USER = "b0000000-0000-4000-8000-000000000001";
const TENANT = "c0000000-0000-4000-8000-000000000001";
const ORG = "d0000000-0000-4000-8000-000000000001";
const COMPANY = "f0000000-0000-4000-8000-000000000001";

function build(authenticated = true) {
  const appended: { viewer: EngagementViewer; event: EngagementEventInput }[] =
    [];
  let stored: ViewingVisibility | null = null;
  const reads: { actorUserId: string; companyId: string }[] = [];
  const investorRecords: { userId: string; investorOrganisationId: string }[] =
    [];
  const investorReads: {
    actorUserId: string;
    organisationId: string | null;
  }[] = [];
  const repository: EngagementRepository = {
    append: (viewer, event) => {
      appended.push({ viewer, event });
      return Promise.resolve(
        event.clientEventId.startsWith("dup") ? "DEDUPLICATED" : "ACCEPTED",
      );
    },
    privacyFor: () =>
      Promise.resolve({
        visibility: stored ?? "ORGANISATION_ONLY",
        chosen: stored !== null,
        defaultVisibility: "ORGANISATION_ONLY",
        allowedVisibilities: ["ORGANISATION_ONLY", "ANONYMOUS"],
      }),
    setPrivacy: (_user, visibility) => {
      // The platform here does not offer Full identity.
      if (visibility === "FULL_IDENTITY") return Promise.resolve("NOT_ALLOWED");
      stored = visibility;
      return Promise.resolve("SAVED");
    },
  };
  const app = createApp(
    parseApiConfig({ NODE_ENV: "test" }),
    {
      authenticator: {
        authenticate: () =>
          Promise.resolve(
            authenticated
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
          Promise.resolve({
            status: "RESOLVED",
            context: {
              userId: UserIdSchema.parse(USER),
              tenantId: TenantIdSchema.parse(TENANT),
              organisationId: OrganisationIdSchema.parse(ORG),
              membershipId: MembershipIdSchema.parse(
                "e0000000-0000-4000-8000-000000000001",
              ),
              actorType: "HUMAN",
            },
          }),
      },
      identities: { lookup: () => Promise.resolve(null) },
    },
    {
      engagement: {
        engagement: createEngagementService({ repository }),
        myEngagement: {
          read: () =>
            Promise.resolve({
              privacy: {
                visibility: "ORGANISATION_ONLY",
                chosen: false,
                defaultVisibility: "ORGANISATION_ONLY",
                allowedVisibilities: ["ORGANISATION_ONLY", "ANONYMOUS"],
              },
              viewed: [],
              responses: [],
            }),
        },
        companyEngagement: {
          read: (query) => {
            reads.push(query);
            return Promise.resolve(null);
          },
        },
        investorViews: {
          record: (actor, view) => {
            investorRecords.push({
              userId: actor.userId,
              investorOrganisationId: view.investorOrganisationId,
            });
            return Promise.resolve("DROPPED");
          },
          mine: (query) => {
            investorReads.push({
              actorUserId: query.actorUserId,
              organisationId: query.organisationId,
            });
            return Promise.resolve(null);
          },
        },
      },
    },
  ).app;
  return { app, appended, reads, investorRecords, investorReads };
}

const view = (clientEventId: string) => ({
  type: "PROFILE_VIEW",
  clientEventId,
  companyId: COMPANY,
  occurredAt: "2026-11-06T10:00:00.000Z",
});

describe("POST /v1/engagement/events", () => {
  it("is 401 without a session", async () => {
    const { app } = build(false);
    const response = await app.inject({
      method: "POST",
      url: ENGAGEMENT_EVENTS_PATH,
      payload: { events: [view("evt-00000001")] },
    });
    expect(response.statusCode).toBe(401);
  });

  it("records as the resolved actor, never a client-named viewer", async () => {
    const { app, appended } = build();
    const response = await app.inject({
      method: "POST",
      url: ENGAGEMENT_EVENTS_PATH,
      payload: {
        events: [
          view("evt-00000001"),
          view("dup-00000002"),
          view("evt-00000001"),
        ],
      },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: 1,
      deduplicated: 2,
      dropped: 0,
    });
    expect(appended).toHaveLength(2);
    expect(appended[0]?.viewer).toEqual({
      tenantId: TENANT,
      userId: USER,
      organisationId: ORG,
    });
  });

  it("refuses a viewer, organisation or visibility in the body", async () => {
    const { app, appended } = build();
    for (const extra of [
      { viewerUserId: USER },
      { organisationId: ORG },
      { visibility: "ANONYMOUS" },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: ENGAGEMENT_EVENTS_PATH,
        payload: { events: [{ ...view("evt-00000003"), ...extra }] },
      });
      expect(response.statusCode).toBe(422);
    }
    expect(appended).toHaveLength(0);
  });

  it("refuses a slide dwell with no slide and an over-long duration", async () => {
    const { app } = build();
    const base = {
      type: "DECK_SLIDE_DWELL",
      clientEventId: "evt-00000004",
      companyId: COMPANY,
      documentId: COMPANY,
      occurredAt: "2026-11-06T10:00:00.000Z",
    };
    for (const event of [
      { ...base, durationMs: 1000 },
      { ...base, slideNumber: 2, durationMs: 3_600_001 },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: ENGAGEMENT_EVENTS_PATH,
        payload: { events: [event] },
      });
      expect(response.statusCode).toBe(422);
    }
  });
});

describe("viewing privacy", () => {
  it("reads the default, then the person's own choice", async () => {
    const { app } = build();
    const before = await app.inject({
      method: "GET",
      url: VIEWING_PRIVACY_PATH,
    });
    expect(before.json()).toEqual({
      visibility: "ORGANISATION_ONLY",
      chosen: false,
      defaultVisibility: "ORGANISATION_ONLY",
      allowedVisibilities: ["ORGANISATION_ONLY", "ANONYMOUS"],
    });
    const put = await app.inject({
      method: "PUT",
      url: VIEWING_PRIVACY_PATH,
      payload: { visibility: "ANONYMOUS" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ visibility: "ANONYMOUS", chosen: true });
  });

  it("refuses a level the platform does not offer", async () => {
    const { app } = build();
    const put = await app.inject({
      method: "PUT",
      url: VIEWING_PRIVACY_PATH,
      payload: { visibility: "FULL_IDENTITY" },
    });
    expect(put.statusCode).toBe(422);
  });

  it("refuses an unknown level", async () => {
    const { app } = build();
    const put = await app.inject({
      method: "PUT",
      url: VIEWING_PRIVACY_PATH,
      payload: { visibility: "PAID_REVEAL" },
    });
    expect(put.statusCode).toBe(422);
  });
});

describe("GET /v1/engagement/companies/:companyId", () => {
  it("reads as the resolved actor and 404s what SQL refuses", async () => {
    const { app, reads } = build();
    const response = await app.inject({
      method: "GET",
      url: `/v1/engagement/companies/${COMPANY}`,
    });
    expect(response.statusCode).toBe(404);
    expect(reads).toEqual([
      { actorUserId: USER, companyId: COMPANY, since: null },
    ]);
  });
});

describe("who viewed an investor", () => {
  const INVESTOR = "f0000000-0000-4000-8000-0000000000aa";

  it("records as the resolved actor and answers 202 even when the view is dropped", async () => {
    const { app, investorRecords } = build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/engagement/investor-views",
      payload: {
        clientEventId: "inv-view-0001",
        investorOrganisationId: INVESTOR,
        occurredAt: "2026-11-06T10:00:00.000Z",
      },
    });
    // Dropped (not visible, own firm or duplicate) looks the same: 202.
    expect(response.statusCode).toBe(202);
    expect(investorRecords).toEqual([
      { userId: USER, investorOrganisationId: INVESTOR },
    ]);
  });

  it("refuses a viewer or visibility in the body", async () => {
    const { app, investorRecords } = build();
    const response = await app.inject({
      method: "POST",
      url: "/v1/engagement/investor-views",
      payload: {
        clientEventId: "inv-view-0002",
        investorOrganisationId: INVESTOR,
        occurredAt: "2026-11-06T10:00:00.000Z",
        viewerUserId: USER,
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(investorRecords).toEqual([]);
  });

  it("is 401 without a session", async () => {
    const { app } = build(false);
    const response = await app.inject({
      method: "GET",
      url: "/v1/engagement/investor-viewing",
    });
    expect(response.statusCode).toBe(401);
  });

  it("reads the actor's own firm, never a named one, and 404s a non-member", async () => {
    const { app, investorReads } = build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/engagement/investor-viewing",
    });
    expect(response.statusCode).toBe(404);
    expect(investorReads).toEqual([{ actorUserId: USER, organisationId: ORG }]);
  });
});
