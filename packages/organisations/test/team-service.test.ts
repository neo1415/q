import { describe, expect, it } from "vitest";

import { CorrelationIdSchema } from "@capital-q/contracts";

import {
  createTeamService,
  hashInvitationToken,
  renderInvitationEmail,
  splitEmails,
  teamRoleOf,
  type InvitationEmail,
  type InvitationMailer,
  type TeamEmailEvent,
  type TeamNoticeEmail,
  type TeamActor,
} from "../src/index.js";
import { MemoryTeamDb } from "../src/testing/memory-team-store.js";

/**
 * G1/G2 team use cases against an in-memory store that keeps the same
 * rules the database does (one pending invitation per email, roles as
 * templates with validity, the last owner kept). No database, no email:
 * the mailer is a fake that records what would be sent.
 */

const correlation = CorrelationIdSchema.parse(
  "cor_00000000-0000-4000-8000-00000000c0de",
);

type World = {
  readonly db: MemoryTeamDb;
  readonly sent: InvitationEmail[];
  readonly notices: TeamNoticeEmail[];
  readonly emailEvents: TeamEmailEvent[];
  readonly service: ReturnType<typeof createTeamService<MemoryTeamDb>>;
  readonly actorOf: (userId: string, organisationId?: string) => TeamActor;
  readonly tokens: string[];
  clock: Date;
};

const ORG = "00000000-0000-4000-8000-0000000000a4";
const ORG_B = "00000000-0000-4000-8000-0000000000b4";
const TENANT = "00000000-0000-4000-8000-0000000000a3";
const TENANT_B = "00000000-0000-4000-8000-0000000000b3";
const DANIEL = "00000000-0000-4000-8000-00000000d001";
const SARA = "00000000-0000-4000-8000-00000000d002";
const JAMES = "00000000-0000-4000-8000-00000000d003";
const PETER = "00000000-0000-4000-8000-00000000d004";
const OUTSIDER = "00000000-0000-4000-8000-00000000d005";

function world(options: { readonly mailer?: InvitationMailer } = {}): World {
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
  for (const [id, name, email] of [
    [DANIEL, "Daniel Reyes", "daniel@northbound.example"],
    [SARA, "Sara Kimani", "sara@northbound.example"],
    [JAMES, "James Okoro", "james@northbound.example"],
    [PETER, "Peter Musa", "peter@northbound.example"],
    [OUTSIDER, "Amara Okafor", "amara@kora.example"],
  ] as const) {
    db.people.set(id, { id, name, email });
  }
  const join = (
    organisationId: string,
    tenantId: string,
    userId: string,
    roles: string[],
    at: string,
  ) => {
    const id = db.id("9");
    db.memberships.push({
      id,
      tenantId,
      organisationId,
      userId,
      status: "active",
      roles,
      joinedAt: at,
    });
    db.contexts.set(userId, db.contexts.get(userId) ?? id);
    return id;
  };
  join(
    ORG,
    TENANT,
    DANIEL,
    ["organisation_admin", "organisation_owner"],
    "2026-01-01T00:00:00.000Z",
  );
  join(ORG, TENANT, SARA, ["organisation_admin"], "2026-02-01T00:00:00.000Z");
  join(ORG, TENANT, JAMES, ["organisation_member"], "2026-03-01T00:00:00.000Z");
  join(
    ORG_B,
    TENANT_B,
    OUTSIDER,
    ["organisation_admin", "organisation_owner"],
    "2026-01-01T00:00:00.000Z",
  );
  const sent: InvitationEmail[] = [];
  const notices: TeamNoticeEmail[] = [];
  const emailEvents: TeamEmailEvent[] = [];
  const tokens: string[] = [];
  const w: World = {
    db,
    sent,
    notices,
    emailEvents,
    tokens,
    clock: new Date("2026-10-06T10:00:00.000Z"),
    actorOf: (userId, organisationId = ORG) => {
      const m = db.memberships.find(
        (x) => x.userId === userId && x.organisationId === organisationId,
      );
      return {
        userId,
        tenantId: db.organisations.get(organisationId)?.tenantId ?? TENANT,
        organisationId,
        ...(m === undefined ? {} : { membershipId: m.id }),
      };
    },
    service: undefined as never,
  };
  let n = 0;
  const service = createTeamService<MemoryTeamDb>({
    store: db.store(),
    journal: {
      record: (_tx, entry) => {
        db.journal.push(entry);
        return Promise.resolve();
      },
    },
    mailer: options.mailer ?? {
      available: true,
      send: (email) => {
        sent.push(email);
        return Promise.resolve();
      },
      notify: (notice) => {
        notices.push(notice);
        return Promise.resolve();
      },
    },
    webOrigin: "https://app.capitalq.example/",
    onEmail: (event) => {
      emailEvents.push(event);
    },
    now: () => w.clock,
    newToken: () => {
      n += 1;
      const token = `tok${String(n).padStart(40, "x")}`;
      tokens.push(token);
      return { token, hash: hashInvitationToken(token) };
    },
  });
  return Object.assign(w, { service });
}

const ok = <T>(
  outcome:
    { ok: true; value: T } | { ok: false; code: string; message: string },
): T => {
  if (!outcome.ok)
    throw new Error(`refused: ${outcome.code} ${outcome.message}`);
  return outcome.value;
};

describe("roles over role templates", () => {
  it("maps codes to Owner, Admin and Member", () => {
    expect(teamRoleOf(["organisation_admin", "organisation_owner"])).toBe(
      "OWNER",
    );
    expect(teamRoleOf(["organisation_admin"])).toBe("ADMIN");
    expect(teamRoleOf(["organisation_member"])).toBe("MEMBER");
    expect(teamRoleOf([])).toBe("MEMBER");
  });
  it("splits pasted addresses once each", () => {
    expect(splitEmails("a@x.io, b@x.io\nA@x.io; b@x.io")).toEqual([
      "a@x.io",
      "b@x.io",
      "A@x.io",
    ]);
  });
});

describe("the team page", () => {
  it("lists owners first, says Firm, and shows invitations only to admins", async () => {
    const w = world();
    const admin = ok(await w.service.team(w.actorOf(SARA)));
    expect(admin.organisation.kind).toBe("FIRM");
    expect(admin.members.map((m) => [m.name, m.role])).toEqual([
      ["Daniel Reyes", "OWNER"],
      ["Sara Kimani", "ADMIN"],
      ["James Okoro", "MEMBER"],
    ]);
    expect(admin.you.can).toEqual({
      invite: true,
      changeRoles: true,
      removeMembers: true,
      own: false,
    });
    ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    const member = ok(await w.service.team(w.actorOf(JAMES)));
    expect(member.invitations).toEqual([]);
    expect(member.you.can.invite).toBe(false);
    expect(ok(await w.service.team(w.actorOf(SARA))).invitations).toHaveLength(
      1,
    );
  });

  it("a person alone is their own organisation: just them, the owner", async () => {
    const w = world();
    const solo = ok(await w.service.team(w.actorOf(OUTSIDER, ORG_B)));
    expect(solo.organisation.kind).toBe("COMPANY");
    expect(solo.members).toHaveLength(1);
    expect(solo.members[0]?.role).toBe("OWNER");
    expect(solo.members[0]?.isYou).toBe(true);
  });
});

describe("cross-tenant negatives", () => {
  it("an actor naming another tenant's organisation gets nothing", async () => {
    const w = world();
    const forged: TeamActor = {
      userId: SARA,
      tenantId: TENANT,
      organisationId: ORG_B,
    };
    expect((await w.service.team(forged)).ok).toBe(false);
    expect(
      (
        await w.service.invite(
          forged,
          { emails: ["x@y.example"], role: "ADMIN" },
          correlation,
        )
      ).ok,
    ).toBe(false);
    expect(w.db.invitations).toHaveLength(0);
  });

  it("an invitation, member or join request of another organisation is not found", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(OUTSIDER, ORG_B),
        { emails: ["kwame@kora.example"], role: "MEMBER" },
        correlation,
      ),
    );
    const theirs = w.db.invitations[0]?.id ?? "";
    const outsiderMembership =
      w.db.memberships.find((m) => m.userId === OUTSIDER)?.id ?? "";
    const revoke = await w.service.revokeInvitation(
      w.actorOf(DANIEL),
      theirs,
      correlation,
    );
    expect(revoke.ok === false && revoke.code).toBe("NOT_FOUND");
    const remove = await w.service.removeMember(
      w.actorOf(DANIEL),
      outsiderMembership,
      null,
      correlation,
    );
    expect(remove.ok === false && remove.code).toBe("NOT_FOUND");
    expect(w.db.invitations[0]?.status).toBe("pending");
    expect(w.db.memberships.find((m) => m.userId === OUTSIDER)?.status).toBe(
      "active",
    );
  });
});

describe("invitation lifecycle", () => {
  it("invites by email with one role, emails a link, and stores only the hash", async () => {
    const w = world();
    const result = ok(
      await w.service.invite(
        w.actorOf(SARA),
        {
          emails: [
            "Peter@Northbound.example",
            "grace.ade@gmail.example",
            "not-an-email",
            "james@northbound.example",
          ],
          role: "MEMBER",
          message: "Welcome aboard!",
        },
        correlation,
      ),
    );
    expect(result.invited.map((i) => [i.email, i.emailed])).toEqual([
      ["peter@northbound.example", true],
      ["grace.ade@gmail.example", true],
    ]);
    expect(result.skipped).toEqual([
      { email: "not-an-email", reason: "INVALID_EMAIL" },
      { email: "james@northbound.example", reason: "ALREADY_MEMBER" },
    ]);
    expect(w.sent).toHaveLength(2);
    expect(w.sent[0]?.link).toBe(
      `https://app.capitalq.example/join/${w.tokens[0] ?? ""}`,
    );
    expect(w.sent[0]).toMatchObject({
      inviterName: "Sara Kimani",
      role: "Member",
      word: "firm",
      message: "Welcome aboard!",
      expiresInDays: 7,
    });
    expect(JSON.stringify(w.db.invitations)).not.toContain(w.tokens[0] ?? "-");
    expect(w.db.journal.map((e) => e.action)).toEqual([
      "invitation.sent",
      "invitation.sent",
    ]);
    expect(JSON.stringify(w.db.journal)).not.toContain("peter@");
    const again = ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "ADMIN" },
        correlation,
      ),
    );
    expect(again.skipped).toEqual([
      { email: "peter@northbound.example", reason: "ALREADY_INVITED" },
    ]);
  });

  it("renders the email with the link and the inviter's words, escaped", () => {
    const rendered = renderInvitationEmail({
      to: "peter@northbound.example",
      organisationName: "Northbound <Capital>",
      word: "firm",
      inviterName: "Sara Kimani",
      role: "Member",
      message: "Welcome aboard!",
      link: "https://app.capitalq.example/join/abc",
      expiresInDays: 7,
    });
    expect(rendered.subject).toBe(
      "Sara Kimani invited you to join Northbound <Capital> on Capital Q",
    );
    expect(rendered.html).toContain("https://app.capitalq.example/join/abc");
    expect(rendered.html).not.toContain("<Capital>");
    expect(rendered.text).toContain("Welcome aboard!");
  });

  it("accepts as the invited email: a membership with that role, acting for it now", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "ADMIN" },
        correlation,
      ),
    );
    const token = w.tokens[0] ?? "";
    const preview = ok(await w.service.previewInvitation(token));
    expect(preview).toMatchObject({
      state: "PENDING",
      organisationName: "Northbound Capital",
      kind: "FIRM",
      role: "ADMIN",
      invitedByName: "Sara Kimani",
      memberCount: 3,
    });
    expect(preview.memberInitials).toEqual(["DR", "SK", "JO"]);
    const joined = ok(
      await w.service.acceptInvitation(PETER, token, correlation),
    );
    expect(joined).toEqual({
      organisationId: ORG,
      name: "Northbound Capital",
      kind: "FIRM",
      role: "ADMIN",
    });
    const peter = w.db.memberships.find((m) => m.userId === PETER);
    expect(peter?.roles).toEqual(["organisation_admin"]);
    expect(w.db.contexts.get(PETER)).toBe(peter?.id);
    expect(w.db.invitations[0]?.status).toBe("accepted");
    // A second tap is the same answer, not a second membership.
    ok(await w.service.acceptInvitation(PETER, token, correlation));
    expect(w.db.memberships.filter((m) => m.userId === PETER)).toHaveLength(1);
    expect(w.db.journal.at(-1)?.membership?.change).toBe("CREATED");
  });

  it("refuses someone signed in with another email, and leaves the invitation pending", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    const out = await w.service.acceptInvitation(
      OUTSIDER,
      w.tokens[0] ?? "",
      correlation,
    );
    expect(out.ok === false && out.code).toBe("WRONG_EMAIL");
    expect(w.db.invitations[0]?.status).toBe("pending");
    expect(
      w.db.memberships.some(
        (m) => m.userId === OUTSIDER && m.organisationId === ORG,
      ),
    ).toBe(false);
  });

  it("expires after 7 days; resend gives a new link and the old one stops working", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    w.clock = new Date("2026-10-14T10:00:00.000Z");
    expect(ok(await w.service.previewInvitation(w.tokens[0] ?? "")).state).toBe(
      "EXPIRED",
    );
    expect(
      ok(await w.service.team(w.actorOf(SARA))).invitations[0]?.state,
    ).toBe("EXPIRED");
    const expired = await w.service.acceptInvitation(
      PETER,
      w.tokens[0] ?? "",
      correlation,
    );
    expect(expired.ok === false && expired.code).toBe("EXPIRED");
    const id = w.db.invitations[0]?.id ?? "";
    ok(await w.service.resendInvitation(w.actorOf(SARA), id, correlation));
    expect(w.sent).toHaveLength(2);
    expect((await w.service.previewInvitation(w.tokens[0] ?? "")).ok).toBe(
      false,
    );
    ok(await w.service.acceptInvitation(PETER, w.tokens[1] ?? "", correlation));
  });

  it("revoked invitations cannot be accepted", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    ok(
      await w.service.revokeInvitation(
        w.actorOf(SARA),
        w.db.invitations[0]?.id ?? "",
        correlation,
      ),
    );
    const out = await w.service.acceptInvitation(
      PETER,
      w.tokens[0] ?? "",
      correlation,
    );
    expect(out.ok === false && out.code).toBe("NOT_PENDING");
    expect(ok(await w.service.team(w.actorOf(SARA))).invitations).toEqual([]);
  });

  it("with no email configured, or a failing relay, the invitation stays to resend", async () => {
    const off = world({
      mailer: {
        available: false,
        send: () => Promise.reject(new Error("never")),
      },
    });
    const a = ok(
      await off.service.invite(
        off.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    expect(a.invited[0]?.emailed).toBe(false);
    const failing = world({
      mailer: {
        available: true,
        send: () => Promise.reject(new Error("relay down")),
      },
    });
    const b = ok(
      await failing.service.invite(
        failing.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    expect(b.invited[0]?.emailed).toBe(false);
    expect(failing.db.invitations).toHaveLength(1);
  });

  it("P15: a failed send hands the inviting admin the link, and logs the domain only", async () => {
    const failing = world({
      mailer: {
        available: true,
        send: () => Promise.reject(new Error("relay down")),
      },
    });
    const out = ok(
      await failing.service.invite(
        failing.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    expect(out.invited[0]?.link).toBe(
      `https://app.capitalq.example/join/${failing.tokens[0] ?? ""}`,
    );
    expect(failing.emailEvents).toEqual([
      expect.objectContaining({
        kind: "INVITATION",
        outcome: "FAILED",
        recipientDomain: "northbound.example",
      }),
    ]);
    expect(JSON.stringify(failing.emailEvents)).not.toContain("peter@");
    // A sent invitation never carries its link back.
    const sentWorld = world();
    const sent = ok(
      await sentWorld.service.invite(
        sentWorld.actorOf(SARA),
        { emails: ["peter@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    expect(sent.invited[0]).not.toHaveProperty("link");
    expect(sentWorld.emailEvents[0]?.outcome).toBe("SENT");
  });
});

describe("role enforcement on the server", () => {
  it("a member cannot invite, change roles or remove", async () => {
    const w = world();
    const sara = w.db.memberships.find((m) => m.userId === SARA)?.id ?? "";
    const invite = await w.service.invite(
      w.actorOf(JAMES),
      { emails: ["x@y.example"], role: "ADMIN" },
      correlation,
    );
    expect(invite.ok === false && invite.code).toBe("NOT_ALLOWED");
    const role = await w.service.changeRole(
      w.actorOf(JAMES),
      sara,
      "MEMBER",
      correlation,
    );
    expect(role.ok === false && role.code).toBe("NOT_ALLOWED");
    const remove = await w.service.removeMember(
      w.actorOf(JAMES),
      sara,
      null,
      correlation,
    );
    expect(remove.ok === false && remove.code).toBe("NOT_ALLOWED");
    const promote = await w.service.changeRole(
      w.actorOf(JAMES),
      w.actorOf(JAMES).membershipId ?? "",
      "ADMIN",
      correlation,
    );
    expect(promote.ok).toBe(false);
  });

  it("an admin changes members and admins, but not an owner", async () => {
    const w = world();
    const james = w.db.memberships.find((m) => m.userId === JAMES)?.id ?? "";
    const daniel = w.db.memberships.find((m) => m.userId === DANIEL)?.id ?? "";
    const team = ok(
      await w.service.changeRole(w.actorOf(SARA), james, "ADMIN", correlation),
    );
    expect(team.members.find((m) => m.userId === JAMES)?.role).toBe("ADMIN");
    const owner = await w.service.changeRole(
      w.actorOf(SARA),
      daniel,
      "MEMBER",
      correlation,
    );
    expect(owner.ok === false && owner.code).toBe("OWNERS_ONLY");
    const removeOwner = await w.service.removeMember(
      w.actorOf(SARA),
      daniel,
      null,
      correlation,
    );
    expect(removeOwner.ok === false && removeOwner.code).toBe("OWNERS_ONLY");
  });

  it("removing someone ends their membership, moves their context and records who picks up", async () => {
    const w = world();
    const james = w.db.memberships.find((m) => m.userId === JAMES)?.id ?? "";
    const sara = w.db.memberships.find((m) => m.userId === SARA)?.id ?? "";
    const team = ok(
      await w.service.removeMember(w.actorOf(DANIEL), james, sara, correlation),
    );
    expect(team.members.map((m) => m.userId)).not.toContain(JAMES);
    expect(w.db.memberships.find((m) => m.id === james)?.status).toBe(
      "revoked",
    );
    const entry = w.db.journal.at(-1);
    expect(entry?.membership).toMatchObject({
      change: "ENDED",
      status: "revoked",
      handedOverToUserId: SARA,
    });
    // James is gone: his own actor no longer reaches the team.
    expect((await w.service.team(w.actorOf(JAMES))).ok).toBe(false);
  });
});

describe("the last owner (in code; the database refuses it too)", () => {
  it("cannot leave, step down, or be removed", async () => {
    const w = world();
    const daniel = w.db.memberships.find((m) => m.userId === DANIEL)?.id ?? "";
    const leave = await w.service.leave(w.actorOf(DANIEL), correlation);
    expect(leave.ok === false && leave.code).toBe("LAST_OWNER");
    const down = await w.service.changeRole(
      w.actorOf(DANIEL),
      daniel,
      "ADMIN",
      correlation,
    );
    expect(down.ok === false && down.code).toBe("LAST_OWNER");
    const self = await w.service.removeMember(
      w.actorOf(DANIEL),
      daniel,
      null,
      correlation,
    );
    expect(self.ok === false && self.code).toBe("NOT_YOURSELF");
    expect(w.db.memberships.find((m) => m.id === daniel)?.roles).toContain(
      "organisation_owner",
    );
  });

  it("hands over: offer, accept, then the old owner may step down and leave", async () => {
    const w = world();
    const sara = w.db.memberships.find((m) => m.userId === SARA)?.id ?? "";
    const daniel = w.db.memberships.find((m) => m.userId === DANIEL)?.id ?? "";
    // Only an owner offers; the member must accept (no dumping).
    const byAdmin = await w.service.offerOwnership(
      w.actorOf(SARA),
      w.db.memberships.find((m) => m.userId === JAMES)?.id ?? "",
      correlation,
    );
    expect(byAdmin.ok === false && byAdmin.code).toBe("OWNERS_ONLY");
    const offered = ok(
      await w.service.offerOwnership(w.actorOf(DANIEL), sara, correlation),
    );
    expect(offered.ownershipOffers[0]?.direction).toBe("FROM_YOU");
    // P15: Sara hears about the offer by email; nothing changes until she accepts.
    expect(w.notices.map((n) => [n.to, n.kind, n.actorName])).toEqual([
      ["sara@northbound.example", "OWNERSHIP_OFFERED", "Daniel Reyes"],
    ]);
    const forSara = ok(await w.service.team(w.actorOf(SARA)));
    expect(forSara.ownershipOffers[0]?.direction).toBe("TO_YOU");
    const accepted = ok(
      await w.service.respondToOwnershipOffer(
        w.actorOf(SARA),
        forSara.ownershipOffers[0]?.offerId ?? "",
        true,
        correlation,
      ),
    );
    expect(accepted.ownerCount).toBe(2);
    ok(
      await w.service.changeRole(
        w.actorOf(DANIEL),
        daniel,
        "ADMIN",
        correlation,
      ),
    );
    const left = ok(await w.service.leave(w.actorOf(DANIEL), correlation));
    expect(left.left).toBe(true);
  });

  it("the database's own check holds even if the rules were skipped", () => {
    const w = world();
    const daniel = w.db.memberships.find((m) => m.userId === DANIEL);
    if (daniel !== undefined) daniel.roles = ["organisation_admin"];
    expect(() => {
      w.db.assertOwners();
    }).toThrow("LAST_OWNER");
  });
});

describe("join requests", () => {
  it("a person asks; an admin lets them in as a member", async () => {
    const w = world();
    ok(
      await w.service.requestToJoin(PETER, ORG, "I run platform", correlation),
    );
    ok(await w.service.requestToJoin(PETER, ORG, null, correlation));
    expect(w.db.joinRequests).toHaveLength(1);
    const forMember = ok(await w.service.team(w.actorOf(JAMES)));
    expect(forMember.joinRequests).toEqual([]);
    const forAdmin = ok(await w.service.team(w.actorOf(SARA)));
    expect(forAdmin.joinRequests[0]).toMatchObject({
      name: "Peter Musa",
      message: "I run platform",
    });
    const byMember = await w.service.decideJoinRequest(
      w.actorOf(JAMES),
      forAdmin.joinRequests[0]?.requestId ?? "",
      true,
      correlation,
    );
    expect(byMember.ok).toBe(false);
    const team = ok(
      await w.service.decideJoinRequest(
        w.actorOf(SARA),
        forAdmin.joinRequests[0]?.requestId ?? "",
        true,
        correlation,
      ),
    );
    expect(team.members.find((m) => m.userId === PETER)?.role).toBe("MEMBER");
    // F11: let in with nowhere active, Peter now acts for Northbound.
    expect(
      (await w.service.myOrganisations(PETER)).items.map((o) => [
        o.name,
        o.active,
      ]),
    ).toEqual([["Northbound Capital", true]]);
    // P15: he hears about it by email, from the admin who decided.
    expect(w.notices).toEqual([
      expect.objectContaining({
        to: "peter@northbound.example",
        kind: "JOIN_APPROVED",
        organisationName: "Northbound Capital",
        actorName: "Sara Kimani",
        link: "https://app.capitalq.example/home",
      }),
    ]);
  });

  it("F11: someone already acting elsewhere keeps their context when let in", async () => {
    const w = world();
    ok(await w.service.requestToJoin(OUTSIDER, ORG, null, correlation));
    const forAdmin = ok(await w.service.team(w.actorOf(SARA)));
    ok(
      await w.service.decideJoinRequest(
        w.actorOf(SARA),
        forAdmin.joinRequests[0]?.requestId ?? "",
        true,
        correlation,
      ),
    );
    expect(
      (await w.service.myOrganisations(OUTSIDER)).items.map((o) => [
        o.name,
        o.active,
      ]),
    ).toEqual([
      ["Kora Health", true],
      ["Northbound Capital", false],
    ]);
  });

  it("P15: a declined request is emailed too; a failing relay never undoes the decision", async () => {
    const w = world({
      mailer: {
        available: true,
        send: () => Promise.resolve(),
        notify: () => Promise.reject(new Error("relay down")),
      },
    });
    ok(await w.service.requestToJoin(PETER, ORG, null, correlation));
    const forAdmin = ok(await w.service.team(w.actorOf(SARA)));
    const out = await w.service.decideJoinRequest(
      w.actorOf(SARA),
      forAdmin.joinRequests[0]?.requestId ?? "",
      false,
      correlation,
    );
    expect(out.ok).toBe(true);
    expect(w.db.joinRequests[0]?.status).toBe("declined");
    expect(w.emailEvents).toEqual([
      expect.objectContaining({
        kind: "JOIN_DECLINED",
        outcome: "FAILED",
        recipientDomain: "northbound.example",
      }),
    ]);
  });

  it("asking to join an organisation that does not exist reads the same", async () => {
    const w = world();
    const out = ok(
      await w.service.requestToJoin(
        PETER,
        "00000000-0000-4000-8000-00000000ffff",
        null,
        correlation,
      ),
    );
    expect(out).toEqual({ requested: true });
  });
});

describe("P14: admitting an approved company claim", () => {
  it("makes the requester the owner of an organisation nobody holds, once", async () => {
    const w = world();
    const EMPTY = "00000000-0000-4000-8000-0000000000e4";
    w.db.organisations.set(EMPTY, {
      id: EMPTY,
      tenantId: TENANT,
      type: "company",
      name: "Unclaimed Co",
      status: "active",
    });
    const input = {
      organisationId: EMPTY,
      userId: PETER,
      role: "OWNER" as const,
      decidedByUserId: DANIEL,
      claimRequestId: "00000000-0000-4000-8000-0000000000c9",
      correlationId: correlation,
    };
    const first = ok(await w.service.admitClaim(input));
    const again = ok(await w.service.admitClaim(input));
    expect(again.membershipId).toBe(first.membershipId);
    const mine = (await w.service.myOrganisations(PETER)).items;
    expect(mine.map((o) => [o.name, o.role, o.active])).toEqual([
      ["Unclaimed Co", "OWNER", true],
    ]);
  });

  it("never makes anyone owner of a company that already has members", async () => {
    const w = world();
    ok(
      await w.service.admitClaim({
        organisationId: ORG_B,
        userId: PETER,
        role: "OWNER",
        decidedByUserId: OUTSIDER,
        claimRequestId: "00000000-0000-4000-8000-0000000000ca",
        correlationId: correlation,
      }),
    );
    const team = ok(await w.service.team(w.actorOf(OUTSIDER, ORG_B)));
    expect(team.members.find((m) => m.userId === PETER)?.role).toBe("MEMBER");
  });
});

describe("the switcher's list", () => {
  it("F11: names the company an organisation is, when it is one", async () => {
    const w = world();
    const kora = w.db.organisations.get(ORG_B);
    if (kora !== undefined)
      w.db.organisations.set(ORG_B, {
        ...kora,
        companyId: "00000000-0000-4000-8000-0000000c0b4b",
      });
    expect(
      (await w.service.myOrganisations(OUTSIDER)).items.map((o) => o.companyId),
    ).toEqual(["00000000-0000-4000-8000-0000000c0b4b"]);
    expect(
      (await w.service.myOrganisations(SARA)).items.map((o) => o.companyId),
    ).toEqual([null]);
  });

  it("lists every organisation the person is in, with the one they act for", async () => {
    const w = world();
    ok(
      await w.service.invite(
        w.actorOf(OUTSIDER, ORG_B),
        { emails: ["sara@northbound.example"], role: "MEMBER" },
        correlation,
      ),
    );
    expect((await w.service.myOrganisations(SARA)).items).toHaveLength(1);
    ok(await w.service.acceptInvitation(SARA, w.tokens[0] ?? "", correlation));
    const mine = await w.service.myOrganisations(SARA);
    expect(mine.items.map((o) => [o.name, o.kind, o.role, o.active])).toEqual([
      ["Northbound Capital", "FIRM", "ADMIN", false],
      ["Kora Health", "COMPANY", "MEMBER", true],
    ]);
    // Leaving the one she acts for moves her back to the other.
    const left = ok(await w.service.leave(w.actorOf(SARA, ORG_B), correlation));
    expect(left.nowActingFor).toBe(ORG);
    expect(
      (await w.service.myOrganisations(SARA)).items.map((o) => o.active),
    ).toEqual([true]);
  });
});
