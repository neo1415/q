import { describe, expect, it } from "vitest";

import { parseQApiConfig } from "@capital-q/config/q-api";
import { QAttentionReportSchema } from "@capital-q/contracts";
import { readAttention, type AttentionPort } from "@capital-q/q-tools";
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
 * RECOVERY-2026-10 B1: GET /v1/q/attention is the reader Q's what_needs_me
 * uses, for the briefing and the Work page: the session actor's own
 * report, with every unread source named, never as empty.
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

const PORT: AttentionPort = {
  sources: {
    UNANSWERED_MESSAGE: [
      (actor) =>
        Promise.resolve(
          actor.userId === CONTEXT.userId
            ? [
                {
                  key: "msg:1",
                  source: "UNANSWERED_MESSAGE",
                  title: "Zino Aviation Capital is waiting for your reply",
                  since: "2026-10-07T15:43:00.000Z",
                  decidable: true,
                },
              ]
            : [],
        ),
    ],
    APPROVAL: [() => Promise.reject(new Error("engine down"))],
  },
};

function buildApp(signedIn = true) {
  const asked: { since: Date | null }[] = [];
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
    attention: (actor, options) => {
      asked.push({ since: options?.since ?? null });
      return readAttention(PORT, actor, {
        now: options?.now,
        since: options?.since ?? null,
      });
    },
  });
  return { app, asked };
}

describe("GET /v1/q/attention", () => {
  it("returns the session actor's report with unread sources named", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/attention",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const report = QAttentionReportSchema.parse(response.json());
    expect(report.items.map((item) => item.title)).toEqual([
      "Zino Aviation Capital is waiting for your reply",
    ]);
    expect(report.unread).toContain("APPROVAL");
    // Sources nobody composed are unread too, never empty.
    expect(report.unread).toContain("HELD_DRAFT");
  });

  it("passes a valid since and refuses one that is malformed or too old", async () => {
    const { app, asked } = buildApp();
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const ok = await app.inject({
      method: "GET",
      url: `/v1/q/attention?since=${encodeURIComponent(since)}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(asked.at(-1)?.since?.toISOString()).toBe(since);
    for (const bad of ["yesterday", "2020-01-01T00:00:00Z"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/q/attention?since=${encodeURIComponent(bad)}`,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("is refused without a session", async () => {
    const { app, asked } = buildApp(false);
    const response = await app.inject({
      method: "GET",
      url: "/v1/q/attention",
    });
    expect(response.statusCode).toBe(401);
    expect(asked).toHaveLength(0);
  });
});
