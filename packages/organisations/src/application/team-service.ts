import {
  INVITATION_TTL_DAYS,
  type AcceptInvitationResultDto,
  type CorrelationId,
  type InvitableRole,
  type InvitationPreviewDto,
  type InviteRequest,
  type InviteResultDto,
  type LeaveResultDto,
  type MyOrganisationsDto,
  type TeamDto,
  type TeamRole,
} from "@capital-q/contracts";

import {
  abilitiesOf,
  canChangeRole,
  canLeave,
  canOfferOwnership,
  canRemove,
  createInvitationToken,
  hashInvitationToken,
  initialsOf,
  invitationExpiry,
  invitationRoleCode,
  invitationRoleOf,
  invitationState,
  normaliseEmail,
  refuse,
  ROLE_CODES_FOR,
  teamKindOf,
  teamRoleOf,
  teamWord,
  type TeamRefusal,
} from "../domain/team.js";
import type {
  InvitationMailer,
  InvitationRecord,
  TeamNoticeEmail,
  TeamJournal,
  TeamMemberRecord,
  TeamOrganisationRecord,
  TeamStore,
} from "./team-ports.js";

/**
 * G1/G2 team use cases: invite, accept, roles, remove, leave, hand over
 * ownership, join requests and the switcher's list.
 *
 * Authority:
 * - The organisation acted in is always the actor's own, resolved on the
 *   server from their membership (ActorContext); nothing from the client
 *   names it. A record of another organisation is "not found".
 * - The actor's role is read from their current role templates inside the
 *   transaction, under a lock on the organisation row, so two admins
 *   cannot both remove the last owner. The database refuses it too.
 * - Accepting an invitation needs the signed-in person's own verified
 *   email (from auth, never the request) to be the invited one.
 *
 * Email goes out after the transaction commits (never held open across a
 * send); a failed send leaves the invitation pending to resend.
 */

export type TeamActor = {
  readonly userId: string;
  readonly tenantId: string;
  readonly organisationId?: string | undefined;
  readonly membershipId?: string | undefined;
};

export type TeamOutcome<T> =
  { readonly ok: true; readonly value: T } | TeamRefusal;

export type TeamServiceDependencies<Tx> = {
  readonly store: TeamStore<Tx>;
  readonly journal: TeamJournal<Tx>;
  readonly mailer: InvitationMailer;
  /** The web origin the accept link is built on (https, or local in dev). */
  readonly webOrigin: string;
  readonly now?: (() => Date) | undefined;
  /** Test seam: a known token. */
  readonly newToken?:
    (() => { readonly token: string; readonly hash: string }) | undefined;
  readonly onWarning?: ((message: string, error: unknown) => void) | undefined;
  /**
   * P15: every team email's outcome, for the service log. Carries the
   * recipient's domain only, never the address.
   */
  readonly onEmail?: ((event: TeamEmailEvent) => void) | undefined;
};

export type TeamEmailEvent = {
  readonly kind: "INVITATION" | TeamNoticeEmail["kind"];
  readonly outcome: "SENT" | "FAILED" | "UNAVAILABLE";
  readonly recipientDomain: string;
  readonly error?: unknown;
};

/** The part of an address after the last @, lower case; never the address. */
export function recipientDomainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "unknown" : email.slice(at + 1).toLowerCase();
}

export type TeamService = {
  readonly team: (actor: TeamActor) => Promise<TeamOutcome<TeamDto>>;
  readonly invite: (
    actor: TeamActor,
    input: InviteRequest,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<InviteResultDto>>;
  readonly resendInvitation: (
    actor: TeamActor,
    invitationId: string,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly revokeInvitation: (
    actor: TeamActor,
    invitationId: string,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly changeRole: (
    actor: TeamActor,
    membershipId: string,
    role: InvitableRole,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly removeMember: (
    actor: TeamActor,
    membershipId: string,
    handOverTo: string | null,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly leave: (
    actor: TeamActor,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<LeaveResultDto>>;
  readonly offerOwnership: (
    actor: TeamActor,
    membershipId: string,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly respondToOwnershipOffer: (
    actor: TeamActor,
    offerId: string,
    accept: boolean,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly decideJoinRequest: (
    actor: TeamActor,
    requestId: string,
    approve: boolean,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<TeamDto>>;
  readonly myOrganisations: (userId: string) => Promise<MyOrganisationsDto>;
  readonly previewInvitation: (
    token: string,
  ) => Promise<TeamOutcome<InvitationPreviewDto>>;
  readonly acceptInvitation: (
    userId: string,
    token: string,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<AcceptInvitationResultDto>>;
  readonly requestToJoin: (
    userId: string,
    organisationId: string,
    message: string | null,
    correlationId: CorrelationId,
  ) => Promise<TeamOutcome<{ readonly requested: true }>>;
};

const ROLE_RANK: Readonly<Record<TeamRole, number>> = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2,
};

const NOT_FOUND = refuse("NOT_FOUND", "That isn't on your team any more.");

function displayName(name: string | null, email: string | null): string {
  const trimmed = name?.trim() ?? "";
  if (trimmed.length > 0) return trimmed.slice(0, 200);
  const local = email?.split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local.slice(0, 200) : "Someone";
}

/** The person-facing word for a role. */
function roleWord(role: InvitableRole): "Admin" | "Member" {
  return role === "ADMIN" ? "Admin" : "Member";
}

export function createTeamService<Tx>(
  dependencies: TeamServiceDependencies<Tx>,
): TeamService {
  const { store, journal, mailer } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const newToken = dependencies.newToken ?? createInvitationToken;
  const origin = dependencies.webOrigin.replace(/\/+$/u, "");

  const acceptLink = (token: string) =>
    `${origin}/join/${encodeURIComponent(token)}`;

  type Scope = {
    readonly organisation: TeamOrganisationRecord;
    readonly members: readonly TeamMemberRecord[];
    readonly me: TeamMemberRecord;
    readonly myRole: TeamRole;
    readonly ownerCount: number;
  };

  /** The actor's own organisation, locked, with them as an active member. */
  async function scope(
    tx: Tx,
    actor: TeamActor,
    lock: boolean = true,
  ): Promise<Scope | null> {
    if (actor.organisationId === undefined) return null;
    const organisation = lock
      ? await store.lockOrganisation(tx, actor.organisationId)
      : await store.organisation(tx, actor.organisationId);
    if (
      organisation === null ||
      organisation.tenantId !== actor.tenantId ||
      organisation.status !== "active"
    ) {
      return null;
    }
    const members = await store.members(tx, organisation.id);
    const me = members.find(
      (member) =>
        member.userId === actor.userId &&
        (actor.membershipId === undefined ||
          member.membershipId === actor.membershipId),
    );
    if (me === undefined) return null;
    return {
      organisation,
      members,
      me,
      myRole: teamRoleOf(me.roleCodes),
      ownerCount: members.filter(
        (member) => teamRoleOf(member.roleCodes) === "OWNER",
      ).length,
    };
  }

  async function teamDto(tx: Tx, s: Scope): Promise<TeamDto> {
    const can = abilitiesOf(s.myRole);
    const at = now();
    const [invitations, joinRequests, offers] = await Promise.all([
      can.invite
        ? store.pendingInvitations(tx, s.organisation.id)
        : Promise.resolve([]),
      can.invite
        ? store.pendingJoinRequests(tx, s.organisation.id)
        : Promise.resolve([]),
      store.pendingOffers(tx, s.organisation.id),
    ]);
    const byMembership = new Map(
      s.members.map((member) => [member.membershipId, member]),
    );
    const nameOf = (membershipId: string) => {
      const member = byMembership.get(membershipId);
      return member === undefined
        ? "Someone"
        : displayName(member.name, member.email);
    };
    const members = [...s.members]
      .map((member) => ({
        member,
        role: teamRoleOf(member.roleCodes),
      }))
      .sort(
        (a, b) =>
          ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
          a.member.joinedAt.localeCompare(b.member.joinedAt) ||
          a.member.membershipId.localeCompare(b.member.membershipId),
      );
    return {
      organisation: {
        organisationId: s.organisation.id,
        name: s.organisation.name,
        kind: teamKindOf(s.organisation.type),
        organisationType: s.organisation.type,
      },
      you: { membershipId: s.me.membershipId, role: s.myRole, can },
      ownerCount: s.ownerCount,
      members: members.map(({ member, role }) => ({
        membershipId: member.membershipId,
        userId: member.userId,
        name: displayName(member.name, member.email),
        email: member.email,
        title: member.title,
        role,
        isYou: member.membershipId === s.me.membershipId,
        joinedAt: member.joinedAt,
      })),
      invitations: invitations.map((invitation) => {
        const state = invitationState(
          invitation.status,
          invitation.expiresAt,
          at,
        );
        return {
          invitationId: invitation.id,
          email: invitation.email,
          role: invitationRoleOf(invitation.roleCode),
          state: state === "EXPIRED" ? "EXPIRED" : "PENDING",
          sentAt: invitation.lastSentAt.toISOString(),
          sentCount: invitation.sentCount,
          expiresAt: invitation.expiresAt.toISOString(),
          invitedByName: invitation.invitedByName,
        };
      }),
      joinRequests: joinRequests.map((request) => ({
        requestId: request.id,
        name: displayName(request.name, request.email),
        email: request.email,
        message: request.message,
        requestedAt: request.createdAt,
      })),
      // Owners see every pending offer; anyone else only one made to them.
      ownershipOffers: offers
        .filter(
          (offer) =>
            s.myRole === "OWNER" || offer.toMembershipId === s.me.membershipId,
        )
        .map((offer) => ({
          offerId: offer.id,
          fromName: nameOf(offer.fromMembershipId),
          toMembershipId: offer.toMembershipId,
          toName: nameOf(offer.toMembershipId),
          direction:
            offer.toMembershipId === s.me.membershipId
              ? "TO_YOU"
              : offer.fromMembershipId === s.me.membershipId
                ? "FROM_YOU"
                : "OTHER",
          offeredAt: offer.createdAt,
        })),
    };
  }

  /** Runs `work` in the actor's own organisation, then answers the fresh team. */
  async function inTeam(
    actor: TeamActor,
    work: (tx: Tx, s: Scope) => Promise<TeamRefusal | null>,
  ): Promise<TeamOutcome<TeamDto>> {
    return store.transaction(async (tx) => {
      const before = await scope(tx, actor);
      if (before === null) return NOT_FOUND;
      const refused = await work(tx, before);
      if (refused !== null) return refused;
      const after = await scope(tx, actor);
      return after === null
        ? NOT_FOUND
        : { ok: true as const, value: await teamDto(tx, after) };
    });
  }

  async function sendInvitation(input: {
    readonly invitationId: string;
    readonly to: string;
    readonly token: string;
    readonly organisation: TeamOrganisationRecord;
    readonly inviterName: string;
    readonly role: InvitableRole;
    readonly message: string | null;
  }): Promise<boolean> {
    const recipientDomain = recipientDomainOf(input.to);
    if (!mailer.available) {
      dependencies.onEmail?.({
        kind: "INVITATION",
        outcome: "UNAVAILABLE",
        recipientDomain,
      });
      return false;
    }
    try {
      await mailer.send({
        to: input.to,
        organisationName: input.organisation.name,
        word: teamWord(teamKindOf(input.organisation.type)),
        inviterName: input.inviterName,
        role: roleWord(input.role),
        message: input.message,
        link: acceptLink(input.token),
        expiresInDays: INVITATION_TTL_DAYS,
      });
      dependencies.onEmail?.({
        kind: "INVITATION",
        outcome: "SENT",
        recipientDomain,
      });
      return true;
    } catch (error: unknown) {
      dependencies.onWarning?.("team invitation email failed", error);
      dependencies.onEmail?.({
        kind: "INVITATION",
        outcome: "FAILED",
        recipientDomain,
        error,
      });
      return false;
    }
  }

  /**
   * P15: a notice after its decision committed. A failed send never undoes
   * the decision; it is logged (domain only) and the app shows the state.
   */
  async function sendNotice(notice: TeamNoticeEmail | null): Promise<void> {
    if (notice === null) return;
    const recipientDomain = recipientDomainOf(notice.to);
    const notify = mailer.notify;
    if (!mailer.available || notify === undefined) {
      dependencies.onEmail?.({
        kind: notice.kind,
        outcome: "UNAVAILABLE",
        recipientDomain,
      });
      return;
    }
    try {
      await notify(notice);
      dependencies.onEmail?.({
        kind: notice.kind,
        outcome: "SENT",
        recipientDomain,
      });
    } catch (error: unknown) {
      dependencies.onWarning?.("team notice email failed", error);
      dependencies.onEmail?.({
        kind: notice.kind,
        outcome: "FAILED",
        recipientDomain,
        error,
      });
    }
  }

  return {
    team: (actor) =>
      store.transaction(async (tx) => {
        const s = await scope(tx, actor, false);
        return s === null
          ? NOT_FOUND
          : { ok: true as const, value: await teamDto(tx, s) };
      }),

    invite: async (actor, input, correlationId) => {
      type Planned = {
        readonly invitationId: string;
        readonly email: string;
        readonly token: string;
      };
      const planned = await store.transaction(async (tx) => {
        const s = await scope(tx, actor);
        if (s === null) return NOT_FOUND;
        if (!abilitiesOf(s.myRole).invite) {
          return refuse("NOT_ALLOWED", "Only admins can invite people.");
        }
        const memberEmails = new Set(
          s.members.flatMap((member) =>
            member.email === null ? [] : [member.email.toLowerCase()],
          ),
        );
        const pending = await store.pendingInvitations(tx, s.organisation.id);
        const pendingEmails = new Map(
          pending.map((invitation) => [invitation.email, invitation]),
        );
        const skipped: InviteResultDto["skipped"][number][] = [];
        const created: Planned[] = [];
        const seen = new Set<string>();
        const message =
          input.message === undefined || input.message.trim() === ""
            ? null
            : input.message.trim();
        for (const raw of input.emails) {
          const email = normaliseEmail(raw);
          if (email === null) {
            skipped.push({ email: raw.trim(), reason: "INVALID_EMAIL" });
            continue;
          }
          if (seen.has(email)) continue;
          seen.add(email);
          if (memberEmails.has(email)) {
            skipped.push({ email, reason: "ALREADY_MEMBER" });
            continue;
          }
          const existing = pendingEmails.get(email);
          const { token, hash } = newToken();
          const expiresAt = invitationExpiry(now(), INVITATION_TTL_DAYS);
          if (existing !== undefined) {
            if (
              invitationState(existing.status, existing.expiresAt, now()) ===
              "PENDING"
            ) {
              skipped.push({ email, reason: "ALREADY_INVITED" });
              continue;
            }
            // Expired: inviting again is a resend with a new link.
            await store.rotateInvitation(tx, existing.id, {
              tokenHash: hash,
              expiresAt,
            });
            await journal.record(tx, {
              action: "invitation.resent",
              tenantId: s.organisation.tenantId,
              organisationId: s.organisation.id,
              actorUserId: actor.userId,
              resourceType: "invitation",
              resourceId: existing.id,
              metadata: { role: existing.roleCode },
              correlationId,
            });
            created.push({ invitationId: existing.id, email, token });
            continue;
          }
          const invitationId = await store.insertInvitation(tx, {
            tenantId: s.organisation.tenantId,
            organisationId: s.organisation.id,
            email,
            roleCode: invitationRoleCode(input.role),
            message,
            tokenHash: hash,
            invitedByUserId: actor.userId,
            expiresAt,
          });
          await journal.record(tx, {
            action: "invitation.sent",
            tenantId: s.organisation.tenantId,
            organisationId: s.organisation.id,
            actorUserId: actor.userId,
            resourceType: "invitation",
            resourceId: invitationId,
            metadata: { role: invitationRoleCode(input.role) },
            correlationId,
          });
          created.push({ invitationId, email, token });
        }
        return {
          ok: true as const,
          value: {
            organisation: s.organisation,
            inviterName: displayName(s.me.name, s.me.email),
            created,
            skipped,
            message,
          },
        };
      });
      if (!planned.ok) return planned;
      const { organisation, inviterName, created, skipped, message } =
        planned.value;
      // After commit: one email each, never inside the transaction.
      const invited = await Promise.all(
        created.map(async (item) => {
          const emailed = await sendInvitation({
            invitationId: item.invitationId,
            to: item.email,
            token: item.token,
            organisation,
            inviterName,
            role: input.role,
            message,
          });
          // P15: when the email did not go, the admin who made the
          // invitation gets its link to pass on themselves. Only to them,
          // only now: the token is never stored and never listed again.
          return emailed
            ? { invitationId: item.invitationId, email: item.email, emailed }
            : {
                invitationId: item.invitationId,
                email: item.email,
                emailed,
                link: acceptLink(item.token),
              };
        }),
      );
      const team = await store.transaction(async (tx) => {
        const s = await scope(tx, actor, false);
        return s === null ? null : teamDto(tx, s);
      });
      if (team === null) return NOT_FOUND;
      return { ok: true, value: { invited, skipped, team } };
    },

    resendInvitation: async (actor, invitationId, correlationId) => {
      const box: {
        mail: {
          readonly invitation: InvitationRecord;
          readonly token: string;
          readonly organisation: TeamOrganisationRecord;
          readonly inviterName: string;
        } | null;
      } = { mail: null };
      const outcome = await inTeam(actor, async (tx, s) => {
        if (!abilitiesOf(s.myRole).invite) {
          return refuse("NOT_ALLOWED", "Only admins can resend invitations.");
        }
        const invitation = await store.invitation(
          tx,
          s.organisation.id,
          invitationId,
        );
        if (invitation === null) return NOT_FOUND;
        if (invitation.status !== "pending") {
          return refuse(
            "NOT_PENDING",
            "That invitation was already used or cancelled.",
          );
        }
        if (invitation.sentCount >= 20) {
          return refuse(
            "NOT_ALLOWED",
            "That invitation was sent too many times. Cancel it and invite again.",
          );
        }
        const { token, hash } = newToken();
        await store.rotateInvitation(tx, invitation.id, {
          tokenHash: hash,
          expiresAt: invitationExpiry(now(), INVITATION_TTL_DAYS),
        });
        await journal.record(tx, {
          action: "invitation.resent",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: { role: invitation.roleCode },
          correlationId,
        });
        box.mail = {
          invitation,
          token,
          organisation: s.organisation,
          inviterName: displayName(s.me.name, s.me.email),
        };
        return null;
      });
      const sending = box.mail;
      if (outcome.ok && sending !== null) {
        await sendInvitation({
          invitationId: sending.invitation.id,
          to: sending.invitation.email,
          token: sending.token,
          organisation: sending.organisation,
          inviterName: sending.inviterName,
          role: invitationRoleOf(sending.invitation.roleCode),
          message: sending.invitation.message,
        });
      }
      return outcome;
    },

    revokeInvitation: (actor, invitationId, correlationId) =>
      inTeam(actor, async (tx, s) => {
        if (!abilitiesOf(s.myRole).invite) {
          return refuse("NOT_ALLOWED", "Only admins can cancel invitations.");
        }
        const invitation = await store.invitation(
          tx,
          s.organisation.id,
          invitationId,
        );
        if (invitation === null) return NOT_FOUND;
        if (invitation.status !== "pending") {
          return refuse(
            "NOT_PENDING",
            "That invitation was already used or cancelled.",
          );
        }
        await store.decideInvitation(tx, invitation.id, {
          status: "revoked",
          decidedByUserId: actor.userId,
          membershipId: null,
        });
        await journal.record(tx, {
          action: "invitation.revoked",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: {},
          correlationId,
        });
        return null;
      }),

    changeRole: (actor, membershipId, role, correlationId) =>
      inTeam(actor, async (tx, s) => {
        const target = s.members.find(
          (member) => member.membershipId === membershipId,
        );
        if (target === undefined) return NOT_FOUND;
        const targetRole = teamRoleOf(target.roleCodes);
        const verdict = canChangeRole({
          actorRole: s.myRole,
          targetRole,
          to: role,
          isSelf: target.membershipId === s.me.membershipId,
          ownerCount: s.ownerCount,
        });
        if (!verdict.ok) return verdict;
        if (targetRole === role) return null;
        await store.setRoles(tx, target.membershipId, ROLE_CODES_FOR[role]);
        await journal.record(tx, {
          action: "membership.role_changed",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "membership",
          resourceId: target.membershipId,
          metadata: { from: targetRole, to: role },
          correlationId,
          membership: {
            change: "ROLE_CHANGED",
            membershipId: target.membershipId,
            userId: target.userId,
            role,
          },
        });
        return null;
      }),

    removeMember: (actor, membershipId, handOverTo, correlationId) =>
      inTeam(actor, async (tx, s) => {
        const target = s.members.find(
          (member) => member.membershipId === membershipId,
        );
        if (target === undefined) return NOT_FOUND;
        const verdict = canRemove({
          actorRole: s.myRole,
          targetRole: teamRoleOf(target.roleCodes),
          isSelf: target.membershipId === s.me.membershipId,
          ownerCount: s.ownerCount,
        });
        if (!verdict.ok) return verdict;
        // Who picks up their open work: someone still on the team.
        const heir =
          s.members.find(
            (member) =>
              member.membershipId === (handOverTo ?? s.me.membershipId) &&
              member.membershipId !== target.membershipId,
          ) ?? s.me;
        await store.endMembership(tx, target.membershipId, "revoked");
        await moveContextAway(
          tx,
          target.userId,
          target.membershipId,
          s.organisation.id,
        );
        await journal.record(tx, {
          action: "membership.removed",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "membership",
          resourceId: target.membershipId,
          metadata: { handedOverToMembershipId: heir.membershipId },
          correlationId,
          membership: {
            change: "ENDED",
            membershipId: target.membershipId,
            userId: target.userId,
            status: "revoked",
            handedOverToUserId: heir.userId,
          },
        });
        return null;
      }),

    leave: (actor, correlationId) =>
      store.transaction(async (tx) => {
        const s = await scope(tx, actor);
        if (s === null) return NOT_FOUND;
        const verdict = canLeave({ role: s.myRole, ownerCount: s.ownerCount });
        if (!verdict.ok) return verdict;
        await store.endMembership(tx, s.me.membershipId, "left");
        const next = await moveContextAway(
          tx,
          actor.userId,
          s.me.membershipId,
          s.organisation.id,
        );
        await journal.record(tx, {
          action: "membership.left",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "membership",
          resourceId: s.me.membershipId,
          metadata: {},
          correlationId,
          membership: {
            change: "ENDED",
            membershipId: s.me.membershipId,
            userId: actor.userId,
            status: "left",
          },
        });
        return {
          ok: true as const,
          value: { left: true as const, nowActingFor: next },
        };
      }),

    offerOwnership: async (actor, membershipId, correlationId) => {
      const box: { notice: TeamNoticeEmail | null } = { notice: null };
      const outcome = await inTeam(actor, async (tx, s) => {
        const target = s.members.find(
          (member) => member.membershipId === membershipId,
        );
        if (target === undefined) return NOT_FOUND;
        const verdict = canOfferOwnership({
          actorRole: s.myRole,
          targetRole: teamRoleOf(target.roleCodes),
          isSelf: target.membershipId === s.me.membershipId,
        });
        if (!verdict.ok) return verdict;
        const offerId = await store.insertOffer(tx, {
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          fromMembershipId: s.me.membershipId,
          toMembershipId: target.membershipId,
        });
        await journal.record(tx, {
          action: "ownership.offered",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "ownership_offer",
          resourceId: offerId,
          metadata: { toMembershipId: target.membershipId },
          correlationId,
        });
        box.notice =
          target.email === null
            ? null
            : {
                to: target.email,
                kind: "OWNERSHIP_OFFERED",
                organisationName: s.organisation.name,
                word: teamWord(teamKindOf(s.organisation.type)),
                actorName: displayName(s.me.name, s.me.email),
                link: `${origin}/settings/team`,
              };
        return null;
      });
      if (outcome.ok) await sendNotice(box.notice);
      return outcome;
    },

    respondToOwnershipOffer: (actor, offerId, accept, correlationId) =>
      inTeam(actor, async (tx, s) => {
        const offer = await store.offer(tx, s.organisation.id, offerId);
        if (offer === null || offer.status !== "pending") return NOT_FOUND;
        const toMe = offer.toMembershipId === s.me.membershipId;
        const fromMe = offer.fromMembershipId === s.me.membershipId;
        if (!toMe && !(fromMe && !accept)) return NOT_FOUND;
        if (accept) {
          // The offer is only as good as the owner who made it, now.
          const from = s.members.find(
            (member) => member.membershipId === offer.fromMembershipId,
          );
          if (from === undefined || teamRoleOf(from.roleCodes) !== "OWNER") {
            await store.decideOffer(tx, offer.id, "cancelled");
            return refuse("NOT_PENDING", "That offer no longer stands.");
          }
          await store.setRoles(tx, s.me.membershipId, ROLE_CODES_FOR.OWNER);
        }
        await store.decideOffer(
          tx,
          offer.id,
          accept ? "accepted" : toMe ? "declined" : "cancelled",
        );
        await journal.record(tx, {
          action: accept ? "ownership.accepted" : "ownership.declined",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "ownership_offer",
          resourceId: offer.id,
          metadata: {},
          correlationId,
          ...(accept
            ? {
                membership: {
                  change: "ROLE_CHANGED" as const,
                  membershipId: s.me.membershipId,
                  userId: actor.userId,
                  role: "OWNER",
                },
              }
            : {}),
        });
        return null;
      }),

    decideJoinRequest: async (actor, requestId, approve, correlationId) => {
      const box: { notice: TeamNoticeEmail | null } = { notice: null };
      const outcome = await inTeam(actor, async (tx, s) => {
        if (!abilitiesOf(s.myRole).invite) {
          return refuse("NOT_ALLOWED", "Only admins can let people in.");
        }
        const request = await store.joinRequest(
          tx,
          s.organisation.id,
          requestId,
        );
        if (request === null || request.status !== "pending") return NOT_FOUND;
        let membershipId: string | null = null;
        if (approve) {
          const already = s.members.find(
            (member) => member.userId === request.userId,
          );
          membershipId =
            already?.membershipId ??
            (await store.insertMembership(tx, {
              tenantId: s.organisation.tenantId,
              organisationId: s.organisation.id,
              userId: request.userId,
              invitedByUserId: actor.userId,
            }));
          if (already === undefined) {
            await store.setRoles(tx, membershipId, ROLE_CODES_FOR.MEMBER);
          }
        }
        // F11: a person let in with nowhere active yet acts for this one
        // now (as accepting an invitation does); someone already working
        // elsewhere keeps their context and switches when they choose.
        if (
          membershipId !== null &&
          (await store.activeContextOf(tx, request.userId)) === null
        ) {
          await store.setActiveContext(tx, request.userId, membershipId);
        }
        await store.decideJoinRequest(tx, request.id, {
          status: approve ? "approved" : "declined",
          decidedByUserId: actor.userId,
          membershipId,
        });
        await journal.record(tx, {
          action: approve ? "join_request.approved" : "join_request.declined",
          tenantId: s.organisation.tenantId,
          organisationId: s.organisation.id,
          actorUserId: actor.userId,
          resourceType: "join_request",
          resourceId: request.id,
          metadata: {},
          correlationId,
          ...(membershipId === null
            ? {}
            : {
                membership: {
                  change: "CREATED" as const,
                  membershipId,
                  userId: request.userId,
                  role: "MEMBER",
                },
              }),
        });
        box.notice =
          request.email === null
            ? null
            : {
                to: request.email,
                kind: approve ? "JOIN_APPROVED" : "JOIN_DECLINED",
                organisationName: s.organisation.name,
                word: teamWord(teamKindOf(s.organisation.type)),
                actorName: displayName(s.me.name, s.me.email),
                link: `${origin}/home`,
              };
        return null;
      });
      if (outcome.ok) await sendNotice(box.notice);
      return outcome;
    },

    myOrganisations: async (userId) => {
      const rows = await store.myOrganisations(userId);
      return {
        items: rows.map((row) => ({
          organisationId: row.organisationId,
          name: row.name,
          kind: teamKindOf(row.type),
          organisationType: row.type,
          role: teamRoleOf(row.roleCodes),
          memberCount: row.memberCount,
          active: row.active,
          companyId: row.companyId,
        })),
      };
    },

    previewInvitation: (token) =>
      store.transaction(async (tx) => {
        const invitation = await store.invitationByTokenHash(
          tx,
          hashInvitationToken(token),
        );
        if (invitation === null) {
          return refuse("NOT_FOUND", "This invitation link isn't valid.");
        }
        const organisation = await store.organisation(
          tx,
          invitation.organisationId,
        );
        if (organisation === null || organisation.status !== "active") {
          return refuse("NOT_FOUND", "This invitation link isn't valid.");
        }
        const members = await store.members(tx, organisation.id);
        return {
          ok: true as const,
          value: {
            state: invitationState(
              invitation.status,
              invitation.expiresAt,
              now(),
            ),
            organisationName: organisation.name,
            kind: teamKindOf(organisation.type),
            role: invitationRoleOf(invitation.roleCode),
            email: invitation.email,
            invitedByName: invitation.invitedByName,
            memberCount: members.length,
            memberInitials: members
              .slice(0, 4)
              .map((member) =>
                initialsOf(displayName(member.name, member.email)),
              ),
          },
        };
      }),

    acceptInvitation: (userId, token, correlationId) =>
      store.transaction(async (tx) => {
        const invitation = await store.invitationByTokenHash(
          tx,
          hashInvitationToken(token),
        );
        if (invitation === null) {
          return refuse("NOT_FOUND", "This invitation link isn't valid.");
        }
        const organisation = await store.lockOrganisation(
          tx,
          invitation.organisationId,
        );
        if (organisation === null || organisation.status !== "active") {
          return refuse("NOT_FOUND", "This invitation link isn't valid.");
        }
        const kind = teamKindOf(organisation.type);
        const members = await store.members(tx, organisation.id);
        const mine = members.find((member) => member.userId === userId);
        if (invitation.status === "accepted") {
          // A second tap on the same link, by the person who used it.
          return mine !== undefined &&
            mine.membershipId === invitation.acceptedMembershipId
            ? {
                ok: true as const,
                value: {
                  organisationId: organisation.id,
                  name: organisation.name,
                  kind,
                  role: teamRoleOf(mine.roleCodes),
                },
              }
            : refuse("NOT_PENDING", "This invitation was already used.");
        }
        if (invitation.status === "revoked") {
          return refuse("NOT_PENDING", "This invitation was cancelled.");
        }
        if (
          invitationState(invitation.status, invitation.expiresAt, now()) ===
          "EXPIRED"
        ) {
          return refuse(
            "EXPIRED",
            `This invitation has expired. Invitations last ${String(INVITATION_TTL_DAYS)} days.`,
          );
        }
        const person = await store.person(tx, userId);
        if (
          person.email === null ||
          normaliseEmail(person.email) !== invitation.email
        ) {
          return refuse(
            "WRONG_EMAIL",
            `This invitation is for ${invitation.email}. Sign in with that email, or ask for an invitation to yours.`,
          );
        }
        let membershipId: string;
        let role: TeamRole;
        if (mine !== undefined) {
          membershipId = mine.membershipId;
          role = teamRoleOf(mine.roleCodes);
        } else {
          role = invitationRoleOf(invitation.roleCode);
          membershipId = await store.insertMembership(tx, {
            tenantId: organisation.tenantId,
            organisationId: organisation.id,
            userId,
            invitedByUserId: invitation.invitedByUserId,
          });
          await store.setRoles(tx, membershipId, ROLE_CODES_FOR[role]);
        }
        await store.decideInvitation(tx, invitation.id, {
          status: "accepted",
          decidedByUserId: userId,
          membershipId,
        });
        // Joining is choosing to act for them now; the switcher holds the rest.
        await store.setActiveContext(tx, userId, membershipId);
        await journal.record(tx, {
          action: "invitation.accepted",
          tenantId: organisation.tenantId,
          organisationId: organisation.id,
          actorUserId: userId,
          resourceType: "invitation",
          resourceId: invitation.id,
          metadata: { role: invitation.roleCode },
          correlationId,
          ...(mine === undefined
            ? {
                membership: {
                  change: "CREATED" as const,
                  membershipId,
                  userId,
                  role,
                },
              }
            : {}),
        });
        return {
          ok: true as const,
          value: {
            organisationId: organisation.id,
            name: organisation.name,
            kind,
            role,
          },
        };
      }),

    requestToJoin: (userId, organisationId, message, correlationId) =>
      store.transaction(async (tx) => {
        const organisation = await store.lockOrganisation(tx, organisationId);
        // Whether it exists is not said: every refusal reads the same.
        const asked = {
          ok: true as const,
          value: { requested: true as const },
        };
        if (organisation === null || organisation.status !== "active") {
          return asked;
        }
        const members = await store.members(tx, organisation.id);
        if (members.some((member) => member.userId === userId)) {
          return refuse("ALREADY_MEMBER", "You're already on this team.");
        }
        const requestId = await store.insertJoinRequest(tx, {
          tenantId: organisation.tenantId,
          organisationId: organisation.id,
          userId,
          message:
            message === null || message.trim() === "" ? null : message.trim(),
        });
        if (requestId !== null) {
          await journal.record(tx, {
            action: "join_request.created",
            tenantId: organisation.tenantId,
            organisationId: organisation.id,
            actorUserId: userId,
            resourceType: "join_request",
            resourceId: requestId,
            metadata: {},
            correlationId,
          });
        }
        return asked;
      }),
  };

  /**
   * A person whose current organisation they no longer belong to acts for
   * another of theirs, if they have one. Returns the organisation they now
   * act for, or null.
   */
  async function moveContextAway(
    tx: Tx,
    userId: string,
    endedMembershipId: string,
    organisationId: string,
  ): Promise<string | null> {
    const current = await store.activeContextOf(tx, userId);
    const other = await store.anotherActiveMembership(
      tx,
      userId,
      organisationId,
    );
    if (current === endedMembershipId && other !== null) {
      await store.setActiveContext(tx, userId, other.membershipId);
    }
    return other?.organisationId ?? null;
  }
}
