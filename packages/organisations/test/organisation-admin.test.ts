import { describe, expect, it } from "vitest";

import {
  ActivityPageDtoSchema,
  MemberSummaryDtoSchema,
} from "@capital-q/contracts";
import {
  AuthorizationDeniedError,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  createAuthorizationService,
  type ActorContext,
  type AuthorizationPolicySource,
} from "@capital-q/security";

import {
  OrganisationActivityQueryError,
  OrganisationMemberNotFoundError,
  createOrganisationAdminService,
  decodeActivityCursor,
  describeAction,
  encodeActivityCursor,
  kindPatterns,
  PRIVATE_ACTION_PATTERNS,
} from "../src/index.js";
import {
  MemoryOrganisationAdminDb,
  likeMatches,
} from "../src/testing/memory-team-store.js";

/**
 * Organisation administration reads: the vocabulary (pure), and the
 * service over an in-memory store with REAL AuthorizationService decisions
 * from role-template facts that mirror the reference data (migration
 * 20261228210000 and supabase/seed.sql). No database, no network.
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
  organisation_member: [
    "organisation.view",
    "company.interest.view",
    "investor.view",
  ],
};

const membershipIdOf = (userId: string) =>
  `00000000-0000-4000-8000-0000000e${userId.slice(-4)}`;

function world() {
  const db = new MemoryOrganisationAdminDb();
  const join = (
    userId: string,
    organisationId: string,
    roleCodes: string[],
    status: "active" | "left" | "revoked" = "active",
  ) => {
    db.memberships.push({
      membershipId: membershipIdOf(userId),
      organisationId,
      userId,
      status,
      joinedAt: "2026-10-01T09:00:00.000000Z",
      leftAt: status === "active" ? null : "2026-10-10T09:00:00.000000Z",
      roleCodes: status === "active" ? roleCodes : [],
      roleHistory: roleCodes.map((roleCode) => ({
        roleCode,
        validFrom: "2026-10-01T09:00:00.000000Z",
        validUntil: status === "active" ? null : "2026-10-10T09:00:00.000000Z",
      })),
    });
  };
  for (const [id, name] of [
    [OWNER, "Daniel Reyes"],
    [ADMIN, "Sara Kimani"],
    [MEMBER, "James Okoro"],
    [LEFT, "Peter Musa"],
    [OTHER, "Amara Okafor"],
  ] as const) {
    db.people.set(id, { userId: id, name, email: null });
  }
  join(OWNER, ORG, ["organisation_admin", "organisation_owner"]);
  join(ADMIN, ORG, ["organisation_admin"]);
  join(MEMBER, ORG, ["organisation_member"]);
  join(LEFT, ORG, ["organisation_admin"], "left");
  join(OTHER, ORG_B, ["organisation_admin", "organisation_owner"]);

  // Facts as the Postgres policy source reads them: the membership must be
  // this person's and active, then its current templates expand.
  const policy: AuthorizationPolicySource = {
    getPolicyFacts: (request) => {
      const m = db.memberships.find(
        (x) =>
          x.membershipId === request.actor.membershipId &&
          x.userId === request.actor.userId &&
          x.organisationId === request.actor.organisationId &&
          x.status === "active",
      );
      const organisationId = request.actor.organisationId;
      if (m === undefined || organisationId === undefined) {
        return Promise.resolve({
          grants: [],
          denials: [],
          unmetRequirements: [],
        });
      }
      const held = m.roleCodes.flatMap((code) => ROLE_CAPABILITIES[code] ?? []);
      return Promise.resolve({
        grants: held.includes(request.capability)
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
  const service = createOrganisationAdminService({
    authorization: createAuthorizationService(policy),
    store: db.store(),
    now: () => new Date("2026-10-20T12:00:00.000Z"),
  });
  return { db, service };
}

function actor(
  userId: string,
  organisationId = ORG,
  tenantId = TENANT,
): ActorContext {
  return {
    userId: UserIdSchema.parse(userId),
    tenantId: TenantIdSchema.parse(tenantId),
    organisationId: OrganisationIdSchema.parse(organisationId),
    membershipId: MembershipIdSchema.parse(membershipIdOf(userId)),
    actorType: "HUMAN",
  };
}

let seq = 0;
function audit(
  db: MemoryOrganisationAdminDb,
  row: Partial<Parameters<MemoryOrganisationAdminDb["audit"]["push"]>[0]> & {
    actionType: string;
    occurredAt: string;
  },
) {
  seq += 1;
  db.audit.push({
    key: seq,
    eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    tenantId: TENANT,
    organisationId: ORG,
    actorType: "human",
    actorId: ADMIN,
    authorityUserId: ADMIN,
    resourceType: "membership",
    resourceId: membershipIdOf(MEMBER),
    outcome: "SUCCEEDED",
    metadata: {},
    ...row,
  });
}

describe("activity vocabulary (pure)", () => {
  it("maps known codes to stable codes, kinds and words; unknown is other", () => {
    expect(describeAction("team.membership.role_changed")).toEqual({
      code: "team.membership.role_changed",
      kind: "TEAM",
      words: "Changed a teammate's role",
    });
    expect(describeAction("app.crm.company_note.add").code).toBe(
      "relationship.note.add",
    );
    expect(describeAction("company.profile.updated").kind).toBe("PROFILE");
    expect(describeAction("something.new.entirely")).toEqual({
      code: "other",
      kind: "OTHER",
      words: "Made a change",
    });
  });

  it("private patterns cover personal Q, reminders and chats; LIKE escapes", () => {
    const hidden = (code: string) =>
      PRIVATE_ACTION_PATTERNS.some((p) => likeMatches(code, p));
    for (const code of [
      "q.action.proposed",
      "q.instruction.grant",
      "q.delegation.enabled",
      "q.workforce.job.start",
      "errand.start",
      "reminder.create",
      "app.schedule.reminder.create",
      "chat.message.send",
      "app.chat.message.send",
      "etiquette_guide.record",
    ]) {
      expect(hidden(code), code).toBe(true);
    }
    expect(hidden("team.invitation.sent")).toBe(false);
    expect(likeMatches("etiquetteXguide.record", "etiquette\\_guide.%")).toBe(
      false,
    );
  });

  it("kind patterns exclude a longer prefix owned by another kind", () => {
    const profile = kindPatterns("PROFILE");
    expect(profile.include).toContain("company.%");
    expect(kindPatterns("OTHER").include).toEqual([]);
    expect(kindPatterns("OTHER").exclude).toContain("team.%");
  });

  it("cursor round-trips and rejects tampering", () => {
    const c = { at: "2026-10-20T10:00:00.123456Z", key: "42" };
    expect(decodeActivityCursor(encodeActivityCursor(c))).toEqual(c);
    expect(decodeActivityCursor("not-a-cursor")).toBeNull();
    expect(
      decodeActivityCursor(Buffer.from("x|1").toString("base64url")),
    ).toBeNull();
    expect(
      decodeActivityCursor(
        Buffer.from("2026-10-20T10:00:00Z|1;drop").toString("base64url"),
      ),
    ).toBeNull();
  });
});

describe("my capabilities", () => {
  it("reads role and abilities from the same policy facts", async () => {
    const { service } = world();
    const owner = await service.myCapabilities(actor(OWNER));
    expect(owner.role).toBe("OWNER");
    expect(owner.team).toEqual({
      invite: true,
      changeRoles: true,
      removeMembers: true,
      own: true,
    });
    expect(owner.capabilities).toContain("organisation.activity.view");
    expect(owner.capabilities).toEqual([...owner.capabilities].sort());

    const admin = await service.myCapabilities(actor(ADMIN));
    expect(admin.role).toBe("ADMIN");
    expect(admin.team.own).toBe(false);
    expect(admin.capabilities).toContain("organisation.activity.view");

    const member = await service.myCapabilities(actor(MEMBER));
    expect(member.role).toBe("MEMBER");
    expect(member.team.invite).toBe(false);
    expect(member.capabilities).not.toContain("organisation.activity.view");
    expect(member.capabilities).not.toContain("organisation.admin");
  });

  it("a left member holds nothing", async () => {
    const { service } = world();
    const out = await service.myCapabilities(actor(LEFT));
    expect(out.capabilities).toEqual([]);
    expect(out.role).toBe("MEMBER");
  });
});

describe("organisation activity", () => {
  it("members and left members are denied; admins and owners see it", async () => {
    const { service } = world();
    await expect(service.activity(actor(MEMBER), {})).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    await expect(service.activity(actor(LEFT), {})).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    await expect(service.activity(actor(OWNER), {})).resolves.toBeDefined();
  });

  it("only the active organisation, never another tenant's rows", async () => {
    const { db, service } = world();
    audit(db, {
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-20T10:00:00.000000Z",
    });
    audit(db, {
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-20T10:01:00.000000Z",
      organisationId: ORG_B,
      tenantId: TENANT_B,
      actorId: OTHER,
      authorityUserId: OTHER,
    });
    const page = await service.activity(actor(ADMIN), {});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.actor.display).toBe("Sara Kimani");
    expect(new Set(db.scopedTo)).toEqual(new Set([ORG]));

    const theirs = await service.activity(actor(OTHER, ORG_B, TENANT_B), {});
    expect(theirs.items).toHaveLength(1);
    expect(theirs.items[0]?.actor.display).toBe("Amara Okafor");
  });

  it("renders Q under a member's authority and hides personal Q", async () => {
    const { db, service } = world();
    audit(db, {
      actionType: "q.action.executed",
      occurredAt: "2026-10-20T10:00:00.000000Z",
      actorType: "q",
      actorId: "00000000-0000-4000-8000-0000000000f1",
      authorityUserId: MEMBER,
      resourceType: "q_action",
      resourceId: "00000000-0000-4000-8000-0000000000f2",
      metadata: {
        actionType: "app.crm.company_note.add",
        runId: "secret-run",
        payloadHash: "abc",
      },
    });
    for (const actionType of [
      "q.action.proposed",
      "q.instruction.grant",
      "q.delegation.enabled",
      "q.workforce.job.start",
      "reminder.create",
      "chat.message.send",
    ]) {
      audit(db, {
        actionType,
        occurredAt: "2026-10-20T09:00:00.000000Z",
        actorType: actionType.startsWith("q.") ? "q" : "human",
        actorId: MEMBER,
        authorityUserId: MEMBER,
      });
    }
    // Q carried out something personal: still hidden.
    audit(db, {
      actionType: "q.action.executed",
      occurredAt: "2026-10-20T09:30:00.000000Z",
      actorType: "q",
      actorId: "00000000-0000-4000-8000-0000000000f1",
      authorityUserId: MEMBER,
      resourceType: "q_action",
      resourceId: "00000000-0000-4000-8000-0000000000f3",
      metadata: { actionType: "app.schedule.reminder.create" },
    });
    const page = await service.activity(actor(ADMIN), {});
    expect(page.items).toHaveLength(1);
    const [item] = page.items;
    expect(item?.actor).toEqual({
      type: "Q",
      userId: MEMBER,
      display: "Q, under James Okoro's approval",
    });
    expect(item?.action.code).toBe("relationship.note.add");
    expect(item?.resource).toEqual({
      kind: "q_action",
      label: "an approved action",
      link: null,
    });
    const text = JSON.stringify(page);
    expect(text).not.toContain("secret-run");
    expect(text).not.toContain("payloadHash");
    expect(ActivityPageDtoSchema.safeParse(page).success).toBe(true);
  });

  it("filters by member, kind and date; refuses a non-member filter", async () => {
    const { db, service } = world();
    audit(db, {
      actionType: "team.invitation.sent",
      occurredAt: "2026-10-18T10:00:00.000000Z",
    });
    audit(db, {
      actionType: "relationship.interest.express",
      occurredAt: "2026-10-19T10:00:00.000000Z",
      actorId: MEMBER,
      authorityUserId: MEMBER,
      resourceType: "company",
      resourceId: "00000000-0000-4000-8000-0000000000c1",
    });
    const byMember = await service.activity(actor(ADMIN), { member: MEMBER });
    expect(byMember.items.map((i) => i.action.code)).toEqual([
      "relationship.interest.express",
    ]);
    const byKind = await service.activity(actor(ADMIN), { kind: "TEAM" });
    expect(byKind.items.map((i) => i.action.kind)).toEqual(["TEAM"]);
    const byDate = await service.activity(actor(ADMIN), {
      from: "2026-10-19T00:00:00Z",
    });
    expect(byDate.items).toHaveLength(1);
    // A former member may be filtered on; another organisation's person not.
    await expect(
      service.activity(actor(ADMIN), { member: LEFT }),
    ).resolves.toBeDefined();
    await expect(
      service.activity(actor(ADMIN), { member: OTHER }),
    ).rejects.toBeInstanceOf(OrganisationMemberNotFoundError);
    await expect(
      service.activity(actor(ADMIN), { organisationId: ORG_B }),
    ).rejects.toBeInstanceOf(OrganisationActivityQueryError);
    await expect(
      service.activity(actor(ADMIN), { cursor: "bogus" }),
    ).rejects.toBeInstanceOf(OrganisationActivityQueryError);
  });

  it("paginates by keyset: stable, complete, no repeats, even with ties", async () => {
    const { db, service } = world();
    for (let i = 0; i < 7; i += 1) {
      audit(db, {
        actionType: "team.invitation.resent",
        // Three share one instant: the key breaks the tie.
        occurredAt:
          i < 3
            ? "2026-10-20T10:00:00.000000Z"
            : `2026-10-20T09:0${i}:00.000000Z`,
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 10; pageNo += 1) {
      const page = await service.activity(actor(ADMIN), {
        limit: 3,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((i) => i.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      // A new row arriving at the top never shifts later pages.
      audit(db, {
        actionType: "team.invitation.resent",
        occurredAt: "2026-10-21T00:00:00.000000Z",
      });
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("shows a role change's stored before -> after", async () => {
    const { db, service } = world();
    audit(db, {
      actionType: "team.membership.role_changed",
      occurredAt: "2026-10-20T10:00:00.000000Z",
      metadata: { from: "MEMBER", to: "ADMIN" },
    });
    const page = await service.activity(actor(OWNER), {});
    expect(page.items[0]?.change).toEqual({ before: "Member", after: "Admin" });
    // Labels come only from the store's authorised resolution; else generic.
    expect(page.items[0]?.resource.label).toBe("a team member");
  });

  it("relationship labels need the pipeline read; otherwise generic", async () => {
    const { db, service } = world();
    const rel = "00000000-0000-4000-8000-0000000000e1";
    db.labels.set(`${ORG}|relationship:${rel}`, {
      relationship: true,
      resolved: {
        label: "Relationship with Kora Health",
        link: "/relationships/company/x",
      },
    });
    audit(db, {
      actionType: "relationship.deal.change",
      occurredAt: "2026-10-20T10:00:00.000000Z",
      resourceType: "relationship",
      resourceId: rel,
    });
    const page = await service.activity(actor(ADMIN), {});
    expect(page.items[0]?.resource.label).toBe("Relationship with Kora Health");
  });
});

describe("member summary", () => {
  it("summarises a member for an admin; denies members; 404 across orgs", async () => {
    const { db, service } = world();
    audit(db, {
      actionType: "relationship.interest.express",
      occurredAt: "2026-10-19T10:00:00.000000Z",
      actorId: MEMBER,
      authorityUserId: MEMBER,
    });
    audit(db, {
      actionType: "q.action.executed",
      occurredAt: "2026-10-19T11:00:00.000000Z",
      actorType: "q",
      actorId: "00000000-0000-4000-8000-0000000000f1",
      authorityUserId: MEMBER,
      metadata: { actionType: "app.document.deck_audience.set" },
    });
    audit(db, {
      actionType: "q.instruction.grant",
      occurredAt: "2026-10-20T11:00:00.000000Z",
      actorType: "q",
      actorId: "00000000-0000-4000-8000-0000000000f1",
      authorityUserId: MEMBER,
    });
    audit(db, {
      actionType: "team.invitation.sent",
      occurredAt: "2026-08-01T10:00:00.000000Z",
      actorId: MEMBER,
      authorityUserId: MEMBER,
    });
    db.invitations.push({
      organisationId: ORG,
      invitedBy: MEMBER,
      invitationId: "00000000-0000-4000-8000-0000000000aa",
      email: "new@northbound.example",
      roleCode: "member",
      status: "pending",
      sentAt: "2026-10-19T10:00:00.000000Z",
      expiresAt: "2026-10-26T10:00:00.000000Z",
    });
    db.touched.set(`${ORG}|${MEMBER}`, [
      {
        relationshipId: "00000000-0000-4000-8000-0000000000e1",
        companyId: "00000000-0000-4000-8000-0000000000c1",
        investorOrganisationId: "00000000-0000-4000-8000-0000000000c2",
        side: "INVESTOR",
        counterpartName: "Kora Health",
        lastTouchedAt: "2026-10-19T10:00:00.000000Z",
        events: 2,
        notes: 1,
      },
    ]);
    const out = await service.memberSummary(actor(ADMIN), MEMBER);
    expect(MemberSummaryDtoSchema.safeParse(out).success).toBe(true);
    expect(out.member).toMatchObject({
      name: "James Okoro",
      status: "ACTIVE",
      role: "MEMBER",
    });
    expect(out.roleHistory).toEqual([
      { role: "MEMBER", from: "2026-10-01T09:00:00.000000Z", until: null },
    ]);
    expect(out.invitationsSent[0]?.state).toBe("PENDING");
    // The personal Q instruction is not "activity".
    expect(out.lastActiveAt).toBe("2026-10-19T11:00:00.000000Z");
    expect(out.last30Days.counts).toEqual([
      { kind: "DOCUMENTS", count: 1 },
      { kind: "RELATIONSHIPS", count: 1 },
    ]);
    expect(out.relationships[0]).toMatchObject({
      label: "Relationship with Kora Health",
      link: "/relationships/company/00000000-0000-4000-8000-0000000000c1",
    });

    const former = await service.memberSummary(actor(OWNER), LEFT);
    expect(former.member.status).toBe("LEFT");
    expect(former.member.role).toBeNull();

    await expect(
      service.memberSummary(actor(MEMBER), ADMIN),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      service.memberSummary(actor(ADMIN), OTHER),
    ).rejects.toBeInstanceOf(OrganisationMemberNotFoundError);
    await expect(
      service.memberSummary(actor(ADMIN), "not-a-uuid"),
    ).rejects.toBeInstanceOf(OrganisationMemberNotFoundError);
  });
});
