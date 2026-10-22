import type {
  ActivityItemDto,
  ActivityPageDto,
  MeCapabilitiesDto,
  MemberSummaryDto,
  TeamDto,
  TeamRole,
} from "@capital-q/contracts";

import { HARBOURLINE, fid, team } from "../account-review/fixtures";

/**
 * Fictional data for /dev/org-review: Harbourline Capital (fictional), its
 * five people, what each role holds, and a feed of who did what. Nothing
 * here is a real person, firm or record.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (at: number) => new Date(at).toISOString();

export const PEOPLE = {
  mira: { userId: fid("6", 1), name: HARBOURLINE.partner },
  jonah: { userId: fid("6", 2), name: "Jonah Pryce" },
  ines: { userId: fid("6", 3), name: "Ines Duarte" },
  sam: { userId: fid("6", 4), name: "Sam Achebe" },
} as const;

/** Who the reviewer is, by role: the owner, an admin, or a member. */
const YOU: Readonly<Record<TeamRole, number>> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };

export function teamAs(role: TeamRole, now: number): TeamDto {
  const base = team("investor", "full", now);
  const me = YOU[role];
  const admin = role !== "MEMBER";
  return {
    ...base,
    you: {
      membershipId: fid("7", me + 1),
      role,
      can: {
        invite: admin,
        changeRoles: admin,
        removeMembers: admin,
        own: role === "OWNER",
      },
    },
    members: base.members.map((member, at) => ({ ...member, isYou: at === me })),
    invitations: admin ? base.invitations : [],
    joinRequests: admin ? base.joinRequests : [],
    // The owner sees the hand-over they started; an admin sees none.
    ownershipOffers:
      role === "OWNER"
        ? [
            {
              offerId: fid("9", 1),
              direction: "FROM_YOU" as const,
              fromName: HARBOURLINE.partner,
              toName: PEOPLE.jonah.name,
              toMembershipId: fid("7", 2),
              offeredAt: iso(now - 1 * DAY),
            },
          ]
        : [],
  };
}

const MEMBER_CAPS = [
  "document.create",
  "document.download",
  "document.view",
  "evidence.record",
  "evidence.view",
  "investor.gateway.view",
  "investor.interest.express",
  "investor.mandate.view",
  "investor.representative.self_edit",
  "investor.view",
  "media.create",
  "media.view",
  "organisation.view",
  "q.action.approve",
];
const ADMIN_CAPS = [
  ...MEMBER_CAPS,
  "company.edit",
  "disclosure.manage",
  "investor.edit",
  "investor.gateway.edit",
  "investor.gateway.publish",
  "investor.mandate.edit",
  "organisation.activity.view",
  "organisation.admin",
];

export function capabilitiesAs(role: TeamRole): MeCapabilitiesDto {
  const held =
    role === "OWNER"
      ? [...ADMIN_CAPS, "organisation.own"]
      : role === "ADMIN"
        ? ADMIN_CAPS
        : MEMBER_CAPS;
  const admin = role !== "MEMBER";
  return {
    organisationId: HARBOURLINE.id,
    membershipId: fid("7", YOU[role] + 1),
    role,
    capabilities: [...held].sort(),
    team: {
      invite: admin,
      changeRoles: admin,
      removeMembers: admin,
      own: role === "OWNER",
    },
  };
}

function item(
  n: number,
  at: number,
  rest: Omit<ActivityItemDto, "id" | "at" | "outcome"> &
    Partial<Pick<ActivityItemDto, "outcome">>,
): ActivityItemDto {
  return { id: fid("a", n), at: iso(at), outcome: "SUCCEEDED", ...rest };
}

const person = (who: { userId: string; name: string }) => ({
  type: "PERSON" as const,
  userId: who.userId,
  display: who.name,
});

export function activityItems(now: number): ActivityItemDto[] {
  return [
    item(1, now - 12 * MIN, {
      actor: {
        type: "Q",
        userId: PEOPLE.jonah.userId,
        display: `Q, under ${PEOPLE.jonah.name}'s approval`,
      },
      action: {
        code: "email.send",
        kind: "MESSAGES",
        words: "Sent an email",
      },
      resource: {
        kind: "relationship",
        label: "Kestrel Grid (fictional)",
        link: `/relationships/company/${fid("c", 1)}`,
      },
      change: null,
    }),
    item(2, now - 2 * HOUR, {
      actor: person(PEOPLE.mira),
      action: {
        code: "team.membership.role_changed",
        kind: "TEAM",
        words: "Changed a teammate's role",
      },
      resource: { kind: "membership", label: PEOPLE.ines.name, link: null },
      change: { before: "Member", after: "Admin" },
    }),
    item(3, now - 5 * HOUR, {
      actor: person(PEOPLE.ines),
      action: {
        code: "relationship.stage.change",
        kind: "RELATIONSHIPS",
        words: "Changed a relationship's stage",
      },
      resource: {
        kind: "relationship",
        label: "Lumen Freight (fictional)",
        link: `/relationships/company/${fid("c", 2)}`,
      },
      change: { before: "Met", after: "In diligence" },
    }),
    item(4, now - 26 * HOUR, {
      actor: person(PEOPLE.sam),
      action: {
        code: "investor.mandate.change",
        kind: "MANDATE",
        words: "Changed the mandate",
      },
      resource: { kind: "investor_mandate", label: "a mandate", link: null },
      change: null,
      outcome: "DENIED",
    }),
    item(5, now - 2 * DAY, {
      actor: person(PEOPLE.jonah),
      action: {
        code: "team.invitation.sent",
        kind: "TEAM",
        words: "Invited someone to the team",
      },
      resource: {
        kind: "invitation",
        label: "oliver@harbourline.example",
        link: null,
      },
      change: null,
    }),
    item(6, now - 3 * DAY, {
      actor: {
        type: "Q",
        userId: PEOPLE.ines.userId,
        display: `Q, under ${PEOPLE.ines.name}'s approval`,
      },
      action: {
        code: "meeting.schedule",
        kind: "MEETINGS",
        words: "Scheduled a meeting",
      },
      resource: { kind: "meeting", label: "a meeting", link: null },
      change: null,
      outcome: "FAILED",
    }),
    item(7, now - 6 * DAY, {
      actor: person(PEOPLE.mira),
      action: {
        code: "organisation.updated",
        kind: "ORGANISATION",
        words: "Updated the organisation's details",
      },
      resource: {
        kind: "organisation",
        label: "the organisation",
        link: "/profile",
      },
      change: null,
    }),
  ];
}

export function activityPage(
  now: number,
  filter: "full" | "filtered" | "empty",
): ActivityPageDto {
  const all = activityItems(now);
  if (filter === "empty") return { items: [], nextCursor: null };
  if (filter === "filtered") {
    return {
      items: all.filter(
        (entry) =>
          entry.action.kind === "TEAM" &&
          entry.actor.userId === PEOPLE.mira.userId,
      ),
      nextCursor: null,
    };
  }
  // A further page waits, so "Show more" is drawn.
  return { items: all, nextCursor: "cmV2aWV3LWN1cnNvcg" };
}

export function memberSummary(now: number): MemberSummaryDto {
  return {
    member: {
      userId: PEOPLE.ines.userId,
      membershipId: fid("7", 3),
      name: PEOPLE.ines.name,
      email: "ines@harbourline.example",
      status: "ACTIVE",
      role: "ADMIN",
      joinedAt: iso(now - 140 * DAY),
      leftAt: null,
    },
    roleHistory: [
      { role: "ADMIN", from: iso(now - 2 * HOUR), until: null },
      { role: "MEMBER", from: iso(now - 140 * DAY), until: iso(now - 2 * HOUR) },
    ],
    invitationsSent: [
      {
        invitationId: fid("8", 3),
        email: "ana@harbourline.example",
        role: "MEMBER",
        state: "ACCEPTED",
        sentAt: iso(now - 40 * DAY),
      },
      {
        invitationId: fid("8", 4),
        email: "leo@harbourline.example",
        role: "MEMBER",
        state: "EXPIRED",
        sentAt: iso(now - 20 * DAY),
      },
    ],
    lastActiveAt: iso(now - 5 * HOUR),
    last30Days: {
      since: iso(now - 30 * DAY),
      counts: [
        { kind: "RELATIONSHIPS", count: 14 },
        { kind: "MESSAGES", count: 6 },
        { kind: "MEETINGS", count: 3 },
        { kind: "DOCUMENTS", count: 2 },
      ],
    },
    relationships: [
      {
        relationshipId: fid("d", 1),
        label: "Lumen Freight (fictional)",
        link: `/relationships/company/${fid("c", 2)}`,
        lastTouchedAt: iso(now - 5 * HOUR),
        events: 4,
        notes: 3,
      },
      {
        relationshipId: fid("d", 2),
        label: "Kestrel Grid (fictional)",
        link: `/relationships/company/${fid("c", 1)}`,
        lastTouchedAt: iso(now - 4 * DAY),
        events: 2,
        notes: 1,
      },
    ],
  };
}

export function memberActivity(now: number): ActivityPageDto {
  return {
    items: activityItems(now).filter(
      (entry) => entry.actor.userId === PEOPLE.ines.userId,
    ),
    nextCursor: null,
  };
}
