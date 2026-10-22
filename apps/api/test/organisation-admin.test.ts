import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import { createOrganisationAdminService } from "@capital-q/organisations";
import { MemoryOrganisationAdminDb } from "@capital-q/organisations/testing";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  createAuthorizationService,
  type AuthorizationPolicySource,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * Organisation administration over HTTP: /v1/me/capabilities,
 * /v1/organisation/activity and /v1/organisation/members/:userId/summary,
 * with the real service and REAL AuthorizationService decisions from
 * role-template facts mirroring the reference data. The actor is resolved
 * the way the server does it (own active membership); a header or query
 * naming another organisation is never authority.
 */

const TENANT = "00000000-0000-4000-8000-0000000000a3";
const TENANT_B = "00000000-0000-4000-8000-0000000000b3";
const ORG = "00000000-0000-4000-8000-0000000000a4";
const ORG_B = "00000000-0000-4000-8000-0000000000b4";
const OWNER = "00000000-0000-4000-8000-00000000d001";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
const MEMBER = "00000000-0000-4000-8000-00000000d003";
const LEFT = "00000000-0000-4000-8000-00000000d004";
const OTHER = "00000000-0000-4000-8000-00000000d005";

const ROLE_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  organisation_admin: [
    "organisation.view",
    "organisation.admin",
    "organisation.activity.view",
    "company.interest.view",
    "investor.view",
  ],
  organisation_owner: ["organisation.view", "organisation.own"],
  organisation_member: ["organisation.view", "investor.view"],
};

const membershipIdOf = (userId: string) =>
  `00000000-0000-4000-8000-0000000e${userId.slice(-4)}`;

function world() {
  const db = new MemoryOrganisationAdminDb();
  const tenantOf = new Map([
    [ORG, TENANT],
    [ORG_B, TENANT_B],
  ]);
  const join = (
    userId: string,
    name: string,
    organisationId: string,
    roleCodes: string[],
    status: "active" | "left" = "active",
  ) => {
    db.people.set(userId, { userId, name, email: null });
    db.memberships.push({
      membershipId: membershipIdOf(userId),
      organisationId,
      userId,
      status,
      joinedAt: "2026-10-01T09:00:00.000000Z",
      leftAt: status === "active" ? null : "2026-10-10T09:00:00.000000Z",
      roleCodes: status === "active" ? roleCodes : [],
      roleHistory: [],
    });
  };
  join(OWNER, "Daniel Reyes", ORG, [
    "organisation_admin",
    "organisation_owner",
  ]);
  join(ADMIN, "Sara Kimani", ORG, ["organisation_admin"]);
  join(MEMBER, "James Okoro", ORG, ["organisation_member"]);
  join(LEFT, "Peter Musa", ORG, ["organisation_admin"], "left");
  join(OTHER, "Amara Okafor", ORG_B, [
    "organisation_admin",
    "organisation_owner",
  ]);

  const policy: AuthorizationPolicySource = {
    getPolicyFacts: (request) => {
      const m = db.memberships.find(
        (x) =>
          x.membershipId === request.actor.membershipId &&
          x.userId === request.actor.userId &&
          x.status === "active",
      );
      const organisationId = request.actor.organisationId;
      const held =
        m === undefined || organisationId === undefined
          ? []
          : m.roleCodes.flatMap((code) => ROLE_CAPABILITIES[code] ?? []);
      return Promise.resolve({
        grants:
          organisationId !== undefined && held.includes(request.capability)
            ? [
                {
                  capability: request.capability,
                  scope: {
                    kind: "ORGANISATION" as const,
                    tenantId: request.actor.tenantId,
                    organisationId,
                  },
                },
              ]
            : [],
        denials: [],
        unmetRequirements: [],
      });
    },
  };
  const organisationAdmin = createOrganisationAdminService({
    authorization: createAuthorizationService(policy),
    store: db.store(),
  });

  let seq = 0;
  const audit = (row: {
    actionType: string;
    occurredAt: string;
    organisationId?: string;
    actorType?: "human" | "q";
    actorId?: string;
    authorityUserId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    seq += 1;
    const organisationId = row.organisationId ?? ORG;
    db.audit.push({
      key: seq,
      eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
      tenantId: tenantOf.get(organisationId) ?? TENANT,
      organisationId,
      actorType: row.actorType ?? "human",
      actorId: row.actorId ?? ADMIN,
      authorityUserId: row.authorityUserId ?? row.actorId ?? ADMIN,
      occurredAt: row.occurredAt,
      actionType: row.actionType,
      resourceType: "membership",
      resourceId: membershipIdOf(MEMBER),
      outcome: "SUCCEEDED",
      metadata: row.metadata ?? {},
    });
  };

  function appAs(userId: string) {
    return createApp(
      parseApiConfig({ NODE_ENV: "test" }),
      {
        authenticator: {
          authenticate: () =>
            Promise.resolve({
              authUserId: AuthUserIdSchema.parse(
                "a0000000-0000-4000-8000-000000000001",
              ),
            }),
        },
        resolver: {
          // The person's own ACTIVE membership; never a client selection.
          resolveHumanContext: () => {
            const m = db.memberships.find(
              (x) => x.userId === userId && x.status === "active",
            );
            return Promise.resolve(
              m === undefined
                ? { status: "CONTEXT_REQUIRED" as const }
                : {
                    status: "RESOLVED" as const,
                    context: {
                      userId: UserIdSchema.parse(userId),
                      tenantId: TenantIdSchema.parse(
                        tenantOf.get(m.organisationId),
                      ),
                      organisationId: OrganisationIdSchema.parse(
                        m.organisationId,
                      ),
                      membershipId: MembershipIdSchema.parse(m.membershipId),
                      actorType: "HUMAN" as const,
                    },
                  },
            );
          },
        },
        identities: {
          lookup: () =>
            Promise.resolve({
              userId: UserIdSchema.parse(userId),
              displayName: null,
            }),
        },
      },
      { organisationAdmin },
    ).app;
  }

  async function get(
    userId: string,
    url: string,
    headers: Record<string, string> = {},
  ) {
    const response = await appAs(userId).inject({
      method: "GET",
      url,
      headers: { authorization: "Bearer test", ...headers },
    });
    return {
      status: response.statusCode,
      type: String(response.headers["content-type"] ?? ""),
      body: JSON.parse(response.body) as Record<string, unknown>,
    };
  }

  return { db, audit, get };
}

type Item = {
  id: string;
  actor: { type: string; display: string; userId: string | null };
  action: { code: string; kind: string };
};

describe("GET /v1/me/capabilities", () => {
  it("returns server-resolved capabilities, role and team abilities", async () => {
    const w = world();
    const owner = await w.get(OWNER, "/v1/me/capabilities");
    expect(owner.status).toBe(200);
    expect(owner.body).toMatchObject({
      organisationId: ORG,
      role: "OWNER",
      team: { invite: true, changeRoles: true, removeMembers: true, own: true },
    });
    expect(owner.body["capabilities"]).toContain("organisation.activity.view");

    const member = await w.get(MEMBER, "/v1/me/capabilities");
    expect(member.status).toBe(200);
    expect(member.body).toMatchObject({
      organisationId: ORG,
      role: "MEMBER",
      team: { invite: false, own: false },
    });
    expect(member.body["capabilities"]).not.toContain(
      "organisation.activity.view",
    );
  });

  it("a person with no active membership gets no capabilities", async () => {
    const w = world();
    const left = await w.get(LEFT, "/v1/me/capabilities");
    expect(left.status).not.toBe(200);
    expect(left.type).toContain("application/problem+json");
  });
});

describe("GET /v1/organisation/activity", () => {
  it("admin sees only their own organisation (cross-tenant negative)", async () => {
    const w = world();
    w.audit({
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-20T10:00:00.000000Z",
    });
    w.audit({
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-20T11:00:00.000000Z",
      organisationId: ORG_B,
      actorId: OTHER,
    });
    const res = await w.get(ADMIN, "/v1/organisation/activity");
    expect(res.status).toBe(200);
    const items = res.body["items"] as Item[];
    expect(items).toHaveLength(1);
    expect(items[0]?.actor.display).toBe("Sara Kimani");
    expect(new Set(w.db.scopedTo)).toEqual(new Set([ORG]));
  });

  it("a member is denied with 403 problem details", async () => {
    const w = world();
    const res = await w.get(MEMBER, "/v1/organisation/activity");
    expect(res.status).toBe(403);
    expect(res.type).toContain("application/problem+json");
    expect(res.body["code"]).toBe("PERMISSION_DENIED");
  });

  it("a left member is denied", async () => {
    const w = world();
    const res = await w.get(LEFT, "/v1/organisation/activity");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body["items"]).toBeUndefined();
  });

  it("a person from another organisation cannot be filtered on", async () => {
    const w = world();
    const res = await w.get(ADMIN, `/v1/organisation/activity?member=${OTHER}`);
    expect(res.status).toBe(404);
    expect(res.type).toContain("application/problem+json");
  });

  it("a client-named organisation is refused, not obeyed", async () => {
    const w = world();
    w.audit({
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-20T11:00:00.000000Z",
      organisationId: ORG_B,
      actorId: OTHER,
    });
    // Selecting another organisation by header: the resolved context does
    // not match it, so nothing is served.
    const forged = await w.get(ADMIN, "/v1/organisation/activity", {
      "x-organisation-id": ORG_B,
    });
    expect(forged.status).not.toBe(200);
    expect(forged.body["items"]).toBeUndefined();
    const res = await w.get(
      ADMIN,
      `/v1/organisation/activity?organisationId=${ORG_B}`,
    );
    expect(res.status).toBe(400);
    expect(res.body["code"]).toBe("INVALID_REQUEST");
  });

  it("paginates by cursor, stably and completely", async () => {
    const w = world();
    for (let i = 0; i < 5; i += 1) {
      w.audit({
        actionType: "team.invitation.resent",
        occurredAt: `2026-10-20T10:0${i}:00.000000Z`,
      });
    }
    const ids: string[] = [];
    let url = "/v1/organisation/activity?limit=2";
    for (let n = 0; n < 5; n += 1) {
      const res = await w.get(ADMIN, url);
      expect(res.status).toBe(200);
      ids.push(...(res.body["items"] as Item[]).map((i) => i.id));
      const next = res.body["nextCursor"];
      if (typeof next !== "string") break;
      url = `/v1/organisation/activity?limit=2&cursor=${encodeURIComponent(next)}`;
    }
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    const bad = await w.get(ADMIN, "/v1/organisation/activity?cursor=zzz");
    expect(bad.status).toBe(400);
  });

  it("renders Q under a member's approval; no personal Q content", async () => {
    const w = world();
    w.audit({
      actionType: "q.action.executed",
      occurredAt: "2026-10-20T10:00:00.000000Z",
      actorType: "q",
      actorId: "00000000-0000-4000-8000-0000000000f1",
      authorityUserId: MEMBER,
      metadata: {
        actionType: "app.document.deck_audience.set",
        runId: "run-secret",
      },
    });
    for (const actionType of [
      "q.action.proposed",
      "q.instruction.grant",
      "q.delegation.enabled",
      "q.workforce.job.start",
      "app.chat.message.send",
    ]) {
      w.audit({
        actionType,
        occurredAt: "2026-10-20T09:00:00.000000Z",
        actorType: "q",
        actorId: "00000000-0000-4000-8000-0000000000f1",
        authorityUserId: MEMBER,
      });
    }
    const res = await w.get(OWNER, "/v1/organisation/activity");
    expect(res.status).toBe(200);
    const items = res.body["items"] as Item[];
    expect(items).toHaveLength(1);
    expect(items[0]?.actor).toEqual({
      type: "Q",
      userId: MEMBER,
      display: "Q, under James Okoro's approval",
    });
    expect(items[0]?.action.code).toBe("document.deck_audience.set");
    expect(JSON.stringify(res.body)).not.toContain("run-secret");
  });
});

describe("GET /v1/organisation/members/:userId/summary", () => {
  it("admin reads a member; member denied; other org's person is 404", async () => {
    const w = world();
    w.audit({
      actionType: "relationship.interest.express",
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
      actorId: MEMBER,
    });
    const ok = await w.get(ADMIN, `/v1/organisation/members/${MEMBER}/summary`);
    expect(ok.status).toBe(200);
    expect(ok.body["member"]).toMatchObject({
      name: "James Okoro",
      role: "MEMBER",
      status: "ACTIVE",
    });
    expect(ok.body["last30Days"]).toMatchObject({
      counts: [{ kind: "RELATIONSHIPS", count: 1 }],
    });

    const denied = await w.get(
      MEMBER,
      `/v1/organisation/members/${ADMIN}/summary`,
    );
    expect(denied.status).toBe(403);
    expect(denied.body["code"]).toBe("PERMISSION_DENIED");

    const foreign = await w.get(
      ADMIN,
      `/v1/organisation/members/${OTHER}/summary`,
    );
    expect(foreign.status).toBe(404);
    const malformed = await w.get(
      ADMIN,
      "/v1/organisation/members/not-a-uuid/summary",
    );
    expect(malformed.status).toBe(404);
  });
});
