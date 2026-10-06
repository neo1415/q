import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  createTeamService,
  hashInvitationToken,
  type InvitationEmail,
} from "@capital-q/organisations";
import { MemoryTeamDb } from "@capital-q/organisations/testing";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import { createApp } from "../src/app.js";

/**
 * G1/G2 over HTTP: the team's routes (reads hand-written, changes generated
 * from the declared team.* actions) with the real team service on an
 * in-memory store and a fake mailer (no live email, ever). The actor is
 * resolved the way the server does it: from the person's own active
 * membership, never from the request.
 */

const ORG = "00000000-0000-4000-8000-0000000000a4";
const ORG_B = "00000000-0000-4000-8000-0000000000b4";
const TENANT = "00000000-0000-4000-8000-0000000000a3";
const TENANT_B = "00000000-0000-4000-8000-0000000000b3";
const OWNER = "00000000-0000-4000-8000-00000000d001";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
const MEMBER = "00000000-0000-4000-8000-00000000d003";
const INVITEE = "00000000-0000-4000-8000-00000000d004";
const OTHER_OWNER = "00000000-0000-4000-8000-00000000d005";

function world() {
  const db = new MemoryTeamDb();
  db.organisations.set(ORG, {
    id: ORG,
    tenantId: TENANT,
    type: "investment_firm",
    name: "Northbound Capital",
    status: "active",
  });
  db.organisations.set(ORG_B, {
    id: ORG_B,
    tenantId: TENANT_B,
    type: "company",
    name: "Kora Health",
    status: "active",
  });
  const people: [string, string, string][] = [
    [OWNER, "Daniel Reyes", "daniel@northbound.example"],
    [ADMIN, "Sara Kimani", "sara@northbound.example"],
    [MEMBER, "James Okoro", "james@northbound.example"],
    [INVITEE, "Peter Musa", "peter@northbound.example"],
    [OTHER_OWNER, "Amara Okafor", "amara@kora.example"],
  ];
  for (const [id, name, email] of people)
    db.people.set(id, { id, name, email });
  const join = (
    organisationId: string,
    tenantId: string,
    userId: string,
    roles: string[],
  ) => {
    const id = db.id("9");
    db.memberships.push({
      id,
      tenantId,
      organisationId,
      userId,
      status: "active",
      roles,
      joinedAt: new Date().toISOString(),
    });
    db.contexts.set(userId, id);
  };
  join(ORG, TENANT, OWNER, ["organisation_admin", "organisation_owner"]);
  join(ORG, TENANT, ADMIN, ["organisation_admin"]);
  join(ORG, TENANT, MEMBER, ["organisation_member"]);
  join(ORG_B, TENANT_B, OTHER_OWNER, [
    "organisation_admin",
    "organisation_owner",
  ]);
  const sent: InvitationEmail[] = [];
  const tokens: string[] = [];
  let n = 0;
  const team = createTeamService({
    store: db.store(),
    journal: {
      record: (_tx, entry) => {
        db.journal.push(entry);
        return Promise.resolve();
      },
    },
    mailer: {
      available: true,
      send: (email) => {
        sent.push(email);
        return Promise.resolve();
      },
    },
    webOrigin: "https://app.capitalq.example",
    newToken: () => {
      n += 1;
      const token = `tok${String(n).padStart(40, "x")}`;
      tokens.push(token);
      return { token, hash: hashInvitationToken(token) };
    },
  });
  return { db, sent, tokens, team };
}

type World = ReturnType<typeof world>;

/** The app as `userId`, whose context is their own active membership. */
function appAs(w: World, userId: string) {
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
        resolveHumanContext: () => {
          const membershipId = w.db.contexts.get(userId);
          const m = w.db.memberships.find(
            (x) => x.id === membershipId && x.status === "active",
          );
          return Promise.resolve(
            m === undefined
              ? { status: "CONTEXT_REQUIRED" as const }
              : {
                  status: "RESOLVED" as const,
                  context: {
                    userId: UserIdSchema.parse(userId),
                    tenantId: TenantIdSchema.parse(m.tenantId),
                    organisationId: OrganisationIdSchema.parse(
                      m.organisationId,
                    ),
                    membershipId: MembershipIdSchema.parse(m.id),
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
    { team: w.team },
  ).app;
}

async function call(
  w: World,
  userId: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const response = await appAs(w, userId).inject({
    method,
    url,
    headers: { authorization: "Bearer test", ...headers },
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    status: response.statusCode,
    body:
      response.body === ""
        ? null
        : (JSON.parse(response.body) as Record<string, unknown>),
  };
}

const membershipOf = (w: World, userId: string, organisationId = ORG) =>
  w.db.memberships.find(
    (m) => m.userId === userId && m.organisationId === organisationId,
  )?.id ?? "";

describe("team routes", () => {
  it("GET /v1/team answers the caller's own team; invitations only for admins", async () => {
    const w = world();
    await call(w, ADMIN, "POST", "/v1/team/invitations", {
      emails: ["peter@northbound.example"],
      role: "MEMBER",
    });
    const admin = await call(w, ADMIN, "GET", "/v1/team");
    expect(admin.status).toBe(200);
    expect((admin.body?.["invitations"] as unknown[]).length).toBe(1);
    const member = await call(w, MEMBER, "GET", "/v1/team");
    expect(member.status).toBe(200);
    expect(member.body?.["invitations"]).toEqual([]);
    const other = await call(w, OTHER_OWNER, "GET", "/v1/team");
    expect((other.body?.["organisation"] as { name: string }).name).toBe(
      "Kora Health",
    );
  });

  it("role enforcement is the server's: a member's invite is refused, an admin's is sent (to the fake mailer)", async () => {
    const w = world();
    const refused = await call(w, MEMBER, "POST", "/v1/team/invitations", {
      emails: ["x@northbound.example"],
      role: "ADMIN",
    });
    expect(refused.status).toBe(409);
    expect(refused.body?.["detail"]).toBe("Only admins can invite people.");
    expect(w.sent).toHaveLength(0);
    const sent = await call(w, ADMIN, "POST", "/v1/team/invitations", {
      emails: ["peter@northbound.example"],
      role: "MEMBER",
      message: "Welcome",
    });
    expect(sent.status).toBe(201);
    expect(w.sent.map((e) => e.to)).toEqual(["peter@northbound.example"]);
    expect(w.sent[0]?.link).toBe(
      `https://app.capitalq.example/join/${w.tokens[0] ?? ""}`,
    );
  });

  it("an admin cannot change or remove the owner; nobody leaves as the last owner", async () => {
    const w = world();
    const role = await call(
      w,
      ADMIN,
      "PUT",
      `/v1/team/members/${membershipOf(w, OWNER)}/role`,
      { role: "MEMBER" },
    );
    expect(role.status).toBe(409);
    const remove = await call(
      w,
      ADMIN,
      "POST",
      `/v1/team/members/${membershipOf(w, OWNER)}/remove`,
      {},
    );
    expect(remove.status).toBe(409);
    const leave = await call(w, OWNER, "POST", "/v1/team/leave", {});
    expect(leave.status).toBe(409);
    expect(String(leave.body?.["detail"])).toContain("only owner");
    const promote = await call(
      w,
      ADMIN,
      "PUT",
      `/v1/team/members/${membershipOf(w, MEMBER)}/role`,
      { role: "ADMIN" },
    );
    expect(promote.status).toBe(200);
  });

  it("cross-tenant: another organisation's member or invitation is the one 404", async () => {
    const w = world();
    await call(w, OTHER_OWNER, "POST", "/v1/team/invitations", {
      emails: ["kwame@kora.example"],
      role: "MEMBER",
    });
    const theirs = w.db.invitations[0]?.id ?? "";
    const revoke = await call(
      w,
      OWNER,
      "DELETE",
      `/v1/team/invitations/${theirs}`,
    );
    expect(revoke.status).toBe(404);
    const remove = await call(
      w,
      OWNER,
      "POST",
      `/v1/team/members/${membershipOf(w, OTHER_OWNER, ORG_B)}/remove`,
      {},
    );
    expect(remove.status).toBe(404);
    expect(w.db.invitations[0]?.status).toBe("pending");
  });

  it("the link previews by header, joins as the invited email, and moves the switcher's context", async () => {
    const w = world();
    await call(w, OTHER_OWNER, "POST", "/v1/team/invitations", {
      emails: ["peter@northbound.example"],
      role: "ADMIN",
    });
    const token = w.tokens[0] ?? "";
    const bad = await call(
      w,
      INVITEE,
      "GET",
      "/v1/invitations/preview",
      undefined,
      { "x-invitation-token": "short" },
    );
    expect(bad.status).toBe(404);
    const preview = await call(
      w,
      INVITEE,
      "GET",
      "/v1/invitations/preview",
      undefined,
      { "x-invitation-token": token },
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      state: "PENDING",
      organisationName: "Kora Health",
      kind: "COMPANY",
      role: "ADMIN",
    });
    const wrong = await call(w, MEMBER, "POST", "/v1/invitations/accept", {
      token,
    });
    expect(wrong.status).toBe(409);
    const joined = await call(w, INVITEE, "POST", "/v1/invitations/accept", {
      token,
    });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ organisationId: ORG_B, role: "ADMIN" });
    const mine = await call(w, INVITEE, "GET", "/v1/me/organisations");
    expect(mine.body?.["items"]).toEqual([
      expect.objectContaining({
        name: "Kora Health",
        active: true,
        role: "ADMIN",
      }),
    ]);
    // The context the server resolves is now the new team's.
    const team = await call(w, INVITEE, "GET", "/v1/team");
    expect((team.body?.["organisation"] as { name: string }).name).toBe(
      "Kora Health",
    );
  });

  it("a removed person's next request no longer resolves to the team", async () => {
    const w = world();
    const removed = await call(
      w,
      OWNER,
      "POST",
      `/v1/team/members/${membershipOf(w, MEMBER)}/remove`,
      {},
    );
    expect(removed.status).toBe(200);
    const after = await call(w, MEMBER, "GET", "/v1/team");
    expect(after.status).not.toBe(200);
  });
});
