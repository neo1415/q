import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import type { QDailyEdition } from "@capital-q/contracts";
import {
  createDailyReaderService,
  type DailyReaderStore,
} from "@capital-q/q-daily";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";

import { createApp, type QApiSecurityDependencies } from "../src/app.js";

/**
 * The Q Daily's routes (DAILY spec §5): the session actor's own editions,
 * PDF and preferences only; another person's edition is a 404.
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
const OWN_EDITION = "11111111-0000-4000-8000-000000000001";
const OTHER_EDITION = "11111111-0000-4000-8000-000000000002";

const EDITION: QDailyEdition = {
  id: OWN_EDITION,
  number: 1,
  editionDate: "2026-10-05",
  frequency: "WEEKLY",
  readerName: "Ada",
  topics: ["Fintech"],
  lead: null,
  sections: [],
  briefs: [],
  chart: null,
  qTake: null,
  generatedAt: "2026-10-05T06:00:00.000Z",
};

function memoryStore(): DailyReaderStore & { readers: string[] } {
  const readers: string[] = [];
  let preferences: Awaited<ReturnType<DailyReaderStore["preferences"]>> = null;
  const owns = (userId: string, tenantId: string) =>
    userId === CONTEXT.userId && tenantId === CONTEXT.tenantId;
  return {
    readers,
    preferences: (userId) => {
      readers.push(userId);
      return Promise.resolve(preferences);
    },
    timeZoneOf: () => Promise.resolve("Africa/Lagos"),
    savePreferences: (_userId, _tenantId, saved) => {
      preferences = {
        frequency: saved.frequency,
        email: saved.email,
        sections: [...saved.sections],
        nextDueAt: saved.nextDueAt?.toISOString() ?? null,
        requestedAt: preferences?.requestedAt ?? null,
      };
      return Promise.resolve();
    },
    request: (_userId, _tenantId, now) => {
      if (preferences !== null) {
        preferences = { ...preferences, requestedAt: now.toISOString() };
      }
      return Promise.resolve();
    },
    latest: (userId, tenantId) =>
      Promise.resolve(owns(userId, tenantId) ? EDITION : null),
    edition: (userId, tenantId, editionId) =>
      Promise.resolve(
        owns(userId, tenantId) && editionId === OWN_EDITION ? EDITION : null,
      ),
    archive: (userId, tenantId) =>
      Promise.resolve(
        owns(userId, tenantId)
          ? [
              {
                id: OWN_EDITION,
                number: 1,
                editionDate: "2026-10-05",
                frequency: "WEEKLY" as const,
                headline: null,
              },
            ]
          : [],
      ),
    lastEditionAt: () => Promise.resolve(null),
  };
}

function buildApp(signedIn = true) {
  const store = memoryStore();
  const security: QApiSecurityDependencies = {
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
  };
  const { app } = createApp(parseQApiConfig({ NODE_ENV: "test" }), security, {
    daily: createDailyReaderService({ store }),
  });
  return { app, store };
}

describe("The Q Daily routes", () => {
  it("reads the session actor's own latest edition, archive and preferences", async () => {
    const { app, store } = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/q/daily" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      latest: { id: OWN_EDITION },
      archive: [{ id: OWN_EDITION }],
      preferences: { frequency: "WEEKLY", email: true },
      preparing: false,
    });
    expect(store.readers).toEqual([CONTEXT.userId]);
  });

  it("serves one edition and its PDF; another's is not found", async () => {
    const { app } = buildApp();
    const own = await app.inject({
      method: "GET",
      url: `/v1/q/daily/editions/${OWN_EDITION}`,
    });
    expect(own.statusCode).toBe(200);
    const pdf = await app.inject({
      method: "GET",
      url: `/v1/q/daily/editions/${OWN_EDITION}/pdf`,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    for (const url of [
      `/v1/q/daily/editions/${OTHER_EDITION}`,
      `/v1/q/daily/editions/${OTHER_EDITION}/pdf`,
      "/v1/q/daily/editions/not-an-id",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    }
  });

  it("saves preferences, refuses a malformed change, and queues one edition", async () => {
    const { app } = buildApp();
    const bad = await app.inject({
      method: "PUT",
      url: "/v1/q/daily/preferences",
      payload: { frequency: "HOURLY" },
    });
    expect(bad.statusCode).toBe(400);
    const saved = await app.inject({
      method: "PUT",
      url: "/v1/q/daily/preferences",
      payload: { frequency: "DAILY", sections: ["DEALS"] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      frequency: "DAILY",
      sections: ["DEALS"],
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/q/daily/requests",
    });
    expect(first.json()).toEqual({ status: "QUEUED", retryAfter: null });
    const second = await app.inject({
      method: "POST",
      url: "/v1/q/daily/requests",
    });
    expect(second.json()).toEqual({
      status: "ALREADY_QUEUED",
      retryAfter: null,
    });
  });

  it("NEGATIVE: needs a session", async () => {
    const { app } = buildApp(false);
    const response = await app.inject({ method: "GET", url: "/v1/q/daily" });
    expect(response.statusCode).toBe(401);
  });
});
