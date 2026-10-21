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
    const c = {
      at: "2026-10-20T10:00:00.123456Z",
      source: "a" as const,
      key: "00000000000000000042",
    };
    expect(decodeActivityCursor(encodeActivityCursor(c))).toEqual(c);
    const n = {
      at: "2026-10-20T10:00:00.123456Z",
      source: "n" as const,
      key: "00000000-0000-4000-8000-0000000000e1",
    };
    expect(decodeActivityCursor(encodeActivityCursor(n))).toEqual(n);
    expect(
      decodeActivityCursor(
        Buffer.from("2026-10-20T10:00:00Z|z|00000000000000000001").toString(
          "base64url",
        ),
      ),
    ).toBeNull();
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

describe("direct person actions in the feed (notes, events, screen actions)", () => {
  const REL = "00000000-0000-4000-8000-0000000000e1";
  const REL_B = "00000000-0000-4000-8000-0000000000e2";
  const COMPANY = "00000000-0000-4000-8000-0000000000c1";
  const INVESTOR = "00000000-0000-4000-8000-0000000000c2";
  const NOTE_1 = "00000000-0000-4000-8000-0000000000a1";
  const NOTE_2 = "00000000-0000-4000-8000-0000000000a2";

  function withRelationships() {
    const w = world();
    // ORG is the investor side of REL; ORG_B is the company behind it.
    w.db.relationships.push(
      {
        id: REL,
        companyId: COMPANY,
        investorOrganisationId: INVESTOR,
        companyOrganisationId: ORG_B,
        investorOrgOrganisationId: ORG,
        companyName: "Kora Health",
        investorName: "Northbound Capital",
      },
      {
        // Not ORG's relationship at all.
        id: REL_B,
        companyId: "00000000-0000-4000-8000-0000000000c3",
        investorOrganisationId: "00000000-0000-4000-8000-0000000000c4",
        companyOrganisationId: ORG_B,
        investorOrgOrganisationId: "00000000-0000-4000-8000-0000000000b9",
        companyName: "Kora Health",
        investorName: "Elsewhere Partners",
      },
    );
    return w;
  }

  const event = (
    over: Partial<
      (typeof MemoryOrganisationAdminDb.prototype.events)[number]
    > & {
      id: string;
      sequence: number;
      eventType: string;
      occurredAt: string;
    },
  ) => ({
    relationshipId: REL,
    actorType: "HUMAN" as const,
    actorId: MEMBER,
    visibility: "relationship_shared",
    correlationId: `cor_${over.id}`,
    ...over,
  });

  it("a member's note and its correction appear with before -> after", async () => {
    const { db, service } = withRelationships();
    db.notes.push(
      {
        id: NOTE_1,
        tenantId: TENANT,
        organisationId: ORG,
        relationshipId: REL,
        authorUserId: MEMBER,
        body: "Runway is 14 months",
        supersedesNoteId: null,
        createdAt: "2026-10-20T09:00:00.000000Z",
      },
      {
        id: NOTE_2,
        tenantId: TENANT,
        organisationId: ORG,
        relationshipId: REL,
        authorUserId: MEMBER,
        body: "Runway is 11 months",
        supersedesNoteId: NOTE_1,
        createdAt: "2026-10-20T10:00:00.000000Z",
      },
      {
        // The counterpart's own note: never ours to read.
        id: "00000000-0000-4000-8000-0000000000a3",
        tenantId: TENANT_B,
        organisationId: ORG_B,
        relationshipId: REL,
        authorUserId: OTHER,
        body: "their private note",
        supersedesNoteId: null,
        createdAt: "2026-10-20T11:00:00.000000Z",
      },
    );
    const page = await service.activity(actor(ADMIN), {});
    expect(page.items.map((i) => i.action.code)).toEqual([
      "relationship.note.correct",
      "relationship.note.add",
    ]);
    const [correction, added] = page.items;
    expect(correction?.actor).toEqual({
      type: "PERSON",
      userId: MEMBER,
      display: "James Okoro",
    });
    expect(correction?.change).toEqual({
      before: "Runway is 14 months",
      after: "Runway is 11 months",
    });
    expect(correction?.resource.label).toBe("Relationship with Kora Health");
    expect(added?.change).toBeNull();
    expect(JSON.stringify(page)).not.toContain("their private note");
  });

  it("a member's stage change appears with before -> after; never personal_private or another org's", async () => {
    const { db, service } = withRelationships();
    db.events.push(
      event({
        id: "00000000-0000-4000-8000-0000000000f1",
        sequence: 1,
        eventType: "discovered",
        visibility: "personal_private",
        occurredAt: "2026-10-18T09:00:00.000000Z",
      }),
      event({
        id: "00000000-0000-4000-8000-0000000000f2",
        sequence: 2,
        eventType: "interest_expressed",
        occurredAt: "2026-10-19T09:00:00.000000Z",
      }),
      event({
        id: "00000000-0000-4000-8000-0000000000f3",
        sequence: 3,
        eventType: "diligence_started",
        occurredAt: "2026-10-20T09:00:00.000000Z",
      }),
      // The founder (another organisation's person) acting on the same
      // relationship: their action, not our member's.
      event({
        id: "00000000-0000-4000-8000-0000000000f4",
        sequence: 4,
        eventType: "relationship_paused",
        actorId: OTHER,
        occurredAt: "2026-10-20T10:00:00.000000Z",
      }),
      // Another organisation's relationship entirely.
      event({
        id: "00000000-0000-4000-8000-0000000000f5",
        relationshipId: REL_B,
        sequence: 1,
        eventType: "interest_expressed",
        occurredAt: "2026-10-20T11:00:00.000000Z",
      }),
    );
    const page = await service.activity(actor(ADMIN), {});
    expect(page.items.map((i) => i.id)).toEqual([
      "00000000-0000-4000-8000-0000000000f3",
      "00000000-0000-4000-8000-0000000000f2",
    ]);
    expect(page.items[0]?.action.code).toBe("relationship.stage.change");
    expect(page.items[0]?.change).toEqual({
      before: "Interest expressed",
      after: "In diligence",
    });
    // The personal_private discovery is not "before" either.
    expect(page.items[1]?.change).toEqual({
      before: null,
      after: "Interest expressed",
    });
    expect(page.items[0]?.actor.display).toBe("James Okoro");
  });

  it("one act is one line: an event wins over its audit row, a service row over its app row", async () => {
    const { db, service } = withRelationships();
    const corr = "00000000-0000-4000-8000-00000000cc01";
    db.events.push(
      event({
        id: "00000000-0000-4000-8000-0000000000f2",
        sequence: 1,
        eventType: "interest_expressed",
        correlationId: `cor_${corr}`,
        occurredAt: "2026-10-19T09:00:00.000000Z",
      }),
    );
    audit(db, {
      actionType: "relationship.interest.express",
      occurredAt: "2026-10-19T09:00:00.000000Z",
      actorId: MEMBER,
      authorityUserId: MEMBER,
      correlationId: corr,
    });
    const corr2 = "00000000-0000-4000-8000-00000000cc02";
    audit(db, {
      actionType: "team.membership.role_changed",
      occurredAt: "2026-10-20T09:00:00.000000Z",
      metadata: { from: "MEMBER", to: "ADMIN" },
      correlationId: corr2,
    });
    audit(db, {
      actionType: "app.team.member.role.set",
      occurredAt: "2026-10-20T09:00:00.000100Z",
      correlationId: corr2,
    });
    const page = await service.activity(actor(OWNER), {});
    expect(page.items.map((i) => i.action.code)).toEqual([
      "team.membership.role_changed",
      "relationship.stage.change",
    ]);
  });

  it("a member's screen action (app.*) appears as the person, without a service row", async () => {
    const { db, service } = withRelationships();
    audit(db, {
      actionType: "app.capital.objective.change",
      occurredAt: "2026-10-20T09:00:00.000000Z",
      actorId: MEMBER,
      authorityUserId: MEMBER,
      resourceType: "capital_objective",
      resourceId: "00000000-0000-4000-8000-0000000000d9",
      metadata: { surface: "SCREEN" },
      correlationId: "00000000-0000-4000-8000-00000000cc03",
    });
    const page = await service.activity(actor(ADMIN), { member: MEMBER });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      actor: { type: "PERSON", userId: MEMBER, display: "James Okoro" },
      action: { code: "capital.objective.change", kind: "CAPITAL" },
      resource: { kind: "capital_objective", label: "a raise", link: null },
    });
  });

  it("the cursor is total across the union, ties included", async () => {
    const { db, service } = withRelationships();
    const at = "2026-10-20T09:00:00.000000Z";
    audit(db, { actionType: "team.invitation.sent", occurredAt: at });
    audit(db, { actionType: "team.invitation.resent", occurredAt: at });
    db.events.push(
      event({
        id: "00000000-0000-4000-8000-0000000000f2",
        sequence: 1,
        eventType: "interest_expressed",
        occurredAt: at,
      }),
    );
    for (const id of [NOTE_1, NOTE_2]) {
      db.notes.push({
        id,
        tenantId: TENANT,
        organisationId: ORG,
        relationshipId: REL,
        authorUserId: MEMBER,
        body: "note",
        supersedesNoteId: null,
        createdAt: at,
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 10; n += 1) {
      const page = await service.activity(actor(ADMIN), {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((i) => i.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("the member summary counts notes and events too", async () => {
    const { db, service } = withRelationships();
    db.notes.push({
      id: NOTE_1,
      tenantId: TENANT,
      organisationId: ORG,
      relationshipId: REL,
      authorUserId: MEMBER,
      body: "note",
      supersedesNoteId: null,
      createdAt: "2026-10-19T09:00:00.000000Z",
    });
    db.events.push(
      event({
        id: "00000000-0000-4000-8000-0000000000f2",
        sequence: 1,
        eventType: "interest_expressed",
        occurredAt: "2026-10-19T10:00:00.000000Z",
      }),
    );
    const out = await service.memberSummary(actor(ADMIN), MEMBER);
    expect(out.lastActiveAt).toBe("2026-10-19T10:00:00.000000Z");
    expect(out.last30Days.counts).toEqual([
      { kind: "RELATIONSHIPS", count: 2 },
    ]);
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
