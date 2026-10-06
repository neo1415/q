import { describe, expect, it } from "vitest";

import { CorrelationIdSchema, type TeamDto } from "@capital-q/contracts";
import {
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  APP_ACTIONS,
  findTeammate,
  isRefusal,
  readOwn,
  type AppActionContext,
  type AppActionPorts,
  type TeamPort,
} from "../src/index.js";

/**
 * G1/G2: Q's two team tools prepare a card for the person's own team only,
 * name a teammate as said (one clear match, else ask), and read_my("team")
 * reads the page's own answer.
 */

const ORG = OrganisationIdSchema.parse("00000000-0000-4000-8000-0000000000a4");
const OTHER = "00000000-0000-4000-8000-0000000000b4";

const context: AppActionContext = {
  actor: {
    userId: UserIdSchema.parse("00000000-0000-4000-8000-00000000d002"),
    tenantId: TenantIdSchema.parse("00000000-0000-4000-8000-0000000000a3"),
    organisationId: ORG,
    membershipId: MembershipIdSchema.parse("00000000-0000-4000-8000-0000000000e2"),
    actorType: "HUMAN",
  },
  idempotencyKey: "k",
  correlationId: CorrelationIdSchema.parse("cor_00000000-0000-4000-8000-00000000c0de"),
  surface: "Q",
};

const member = (name: string, role: "OWNER" | "ADMIN" | "MEMBER", n: number) => ({
  membershipId: `00000000-0000-4000-8000-0000000000e${String(n)}`,
  userId: `00000000-0000-4000-8000-00000000d00${String(n)}`,
  name,
  email: `${name.split(" ")[0]?.toLowerCase() ?? "x"}@northbound.example`,
  title: null,
  role,
  isYou: n === 2,
  joinedAt: "2026-01-01T00:00:00.000Z",
});

const TEAM: TeamDto = {
  organisation: { organisationId: ORG, name: "Northbound Capital", kind: "FIRM", organisationType: "investment_firm" },
  you: { membershipId: member("Sara Kimani", "ADMIN", 2).membershipId, role: "ADMIN", can: { invite: true, changeRoles: true, removeMembers: true, own: false } },
  ownerCount: 1,
  members: [member("Daniel Reyes", "OWNER", 1), member("Sara Kimani", "ADMIN", 2), member("James Okoro", "MEMBER", 3), member("James Hale", "MEMBER", 4)],
  invitations: [{ invitationId: "00000000-0000-4000-8000-0000000000f1", email: "peter@northbound.example", role: "MEMBER", state: "EXPIRED", sentAt: "2026-09-01T00:00:00.000Z", sentCount: 1, expiresAt: "2026-09-08T00:00:00.000Z", invitedByName: "Sara Kimani" }],
  joinRequests: [],
  ownershipOffers: [],
};

const unused = () => Promise.reject(new Error("not used here"));
const team: TeamPort = {
  team: () => Promise.resolve({ ok: true, value: TEAM }),
  invite: unused,
  resendInvitation: unused,
  revokeInvitation: unused,
  changeRole: unused,
  removeMember: unused,
  leave: unused,
  offerOwnership: unused,
  respondToOwnershipOffer: unused,
  decideJoinRequest: unused,
  acceptInvitation: unused,
  requestToJoin: unused,
};
const ports: AppActionPorts = { team };

const action = (name: string) => {
  const found = APP_ACTIONS.find((a) => a.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};

describe("Q's team tools", () => {
  it("invite_colleague prepares a card bound to their own organisation", async () => {
    const invite = action("team.invite");
    expect(invite.classification).toBe("CONSEQUENTIAL");
    const canonical = await invite.tool?.toCanonical(
      invite.tool.input.parse({ emails: ["peter@northbound.example"] }),
      context,
      ports,
    );
    expect(canonical).toEqual({ organisationId: ORG, input: { emails: ["peter@northbound.example"], role: "MEMBER" } });
    expect(invite.targets(canonical)).toEqual([{ kind: "ORGANISATION", organisationId: ORG }]);
    expect(invite.card(canonical).summary).toBe("Invite peter@northbound.example to your team as a Member");
  });

  it("refuses a card that names someone else's organisation", async () => {
    const invite = action("team.invite");
    const verdict = await invite.authorize(ports, context, { organisationId: OTHER, input: { emails: ["a@b.example"], role: "MEMBER" } });
    expect(verdict.ok).toBe(false);
    const own = await invite.authorize(ports, context, { input: { emails: ["a@b.example"], role: "MEMBER" } });
    expect(own.ok).toBe(true);
  });

  it("change_team_role names one clear teammate, and asks when several match", async () => {
    const role = action("team.member.role.set");
    const one = await role.tool?.toCanonical({ person: "Daniel", role: "ADMIN" }, context, ports);
    expect(one).toMatchObject({ organisationId: ORG, membershipId: TEAM.members[0]?.membershipId, name: "Daniel Reyes" });
    const several = await role.tool?.toCanonical({ person: "James", role: "ADMIN" }, context, ports);
    expect(isRefusal(several) && several.refused).toContain("Which one?");
    expect(typeof findTeammate(TEAM.members, "nobody")).toBe("string");
  });

  it("read_my(team) lists people with roles, then invitations", async () => {
    const items = await readOwn(ports, context.actor, "team");
    expect(items?.map((item) => [item.title, item.status])).toEqual([
      ["Daniel Reyes", "Owner"],
      ["Sara Kimani (you)", "Admin"],
      ["James Okoro", "Member"],
      ["James Hale", "Member"],
      ["peter@northbound.example", "invited as Member; the link expired"],
    ]);
  });

  it("a refusal is the person's words, a not-found the one 404", () => {
    const http = action("team.member.remove").http;
    expect(http?.problem?.({ ok: false, code: "LAST_OWNER", message: "Every team keeps at least one owner." })).toEqual({ code: "RESOURCE_CONFLICT", detail: "Every team keeps at least one owner." });
    expect(http?.problem?.({ ok: false, code: "NOT_FOUND", message: "x" })).toBeNull();
    expect(http?.notFound?.({ ok: false, code: "NOT_FOUND", message: "x" })).toBe(true);
  });
});
