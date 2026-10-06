import { z } from "zod";

import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResultDtoSchema,
  ChangeRoleRequestSchema,
  CreateJoinRequestSchema,
  INVITATION_ACCEPT_PATH,
  InvitableRoleSchema,
  InviteRequestSchema,
  InviteResultDtoSchema,
  JOIN_REQUESTS_PATH,
  JoinRequestDecisionRequestSchema,
  JoinRequestResultDtoSchema,
  LeaveResultDtoSchema,
  OwnershipOfferRequestSchema,
  OwnershipOfferResponseRequestSchema,
  RemoveMemberRequestSchema,
  TEAM_INVITATION_PATH,
  TEAM_INVITATION_RESEND_PATH,
  TEAM_INVITATIONS_PATH,
  TEAM_JOIN_REQUEST_DECISION_PATH,
  TEAM_LEAVE_PATH,
  TEAM_MEMBER_REMOVE_PATH,
  TEAM_MEMBER_ROLE_PATH,
  TEAM_OWNERSHIP_OFFER_RESPONSE_PATH,
  TEAM_OWNERSHIP_OFFERS_PATH,
  TeamDtoSchema,
  UuidSchema,
  type KnownErrorCode,
  type QSubjectRef,
  type TeamDto,
} from "@capital-q/contracts";
import type { TeamOutcome, TeamService } from "@capital-q/organisations";

import {
  defineAppAction,
  definePersonAction,
  portMissing,
  refusal,
  type AnyAppAction,
  type AnyPersonAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import type { OwnReadItem } from "../reads.js";

/**
 * G1/G2 (ADR 0040): the team actions, each declared once, so its route and
 * (where Q takes it) its tool come from the same declaration.
 *
 * The organisation acted in is never input: the team service acts in the
 * actor's own active organisation, resolved on the server. A canonical
 * input may carry the organisation id only so an approval card can bind
 * to it; authorize refuses one that is not the actor's own.
 *
 * Q takes three of them (the founder's list): inviting a colleague and
 * changing a role, each on an approval card, and listing the team through
 * read_my("team"). The rest are a person's own decisions about who they
 * work with (remove, leave, ownership, letting someone in, accepting an
 * invitation): Q offers the Team page for those.
 */

export type TeamPort = Pick<
  TeamService,
  | "team"
  | "invite"
  | "resendInvitation"
  | "revokeInvitation"
  | "changeRole"
  | "removeMember"
  | "leave"
  | "offerOwnership"
  | "respondToOwnershipOffer"
  | "decideJoinRequest"
  | "acceptInvitation"
  | "requestToJoin"
>;

const team = (ports: AppActionPorts) => ports.team ?? portMissing("team");

const result = <T>(): z.ZodType<T> => z.custom<T>();

const OrganisationField = UuidSchema.optional();

/** Only the actor's own organisation may be named, and only for the card. */
const ownOrganisation = (
  _ports: AppActionPorts,
  context: AppActionContext,
  input: { readonly organisationId?: string | undefined },
) =>
  Promise.resolve(
    input.organisationId === undefined ||
      input.organisationId === context.actor.organisationId
      ? { ok: true as const }
      : { ok: false as const, reason: "That isn't your team." },
  );

const organisationTarget = (
  organisationId: string | undefined,
): readonly QSubjectRef[] =>
  organisationId === undefined
    ? []
    : [{ kind: "ORGANISATION", organisationId }];

const CONFLICT = "RESOURCE_CONFLICT" as KnownErrorCode;

/** A refusal is the person's words as a problem; "not found" is the one 404. */
function teamHttp<T>(respond: (value: T) => unknown) {
  return {
    notFound: (out: TeamOutcome<T>) => !out.ok && out.code === "NOT_FOUND",
    problem: (out: TeamOutcome<T>) =>
      out.ok || out.code === "NOT_FOUND"
        ? null
        : { code: CONFLICT, detail: out.message },
    respond: (out: TeamOutcome<T>) => (out.ok ? respond(out.value) : null),
  };
}

const teamDone = <T>(out: TeamOutcome<T>, words: string) =>
  out.ok ? words : out.message;
const succeeded = <T>(out: TeamOutcome<T>) => out.ok;

const toTeamDto = (value: TeamDto) => TeamDtoSchema.parse(value);

// --- invite a colleague (Q: approval) -----------------------------------

const Invite = z
  .object({ organisationId: OrganisationField, input: InviteRequestSchema })
  .strict();
type InviteInput = z.infer<typeof Invite>;

const InviteTool = z
  .object({
    emails: z
      .array(z.string().trim().min(3).max(254))
      .min(1)
      .max(10)
      .describe(
        "The email address(es) they gave, exactly as said. Never guess or invent an address; ask for it if they did not say it.",
      ),
    role: InvitableRoleSchema.default("MEMBER").describe(
      "MEMBER (works day to day; the default) or ADMIN (can also invite people and approve what Q sends), only if they said so.",
    ),
    message: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe("A short note from them for the email, only if they gave one."),
  })
  .strict();
type InviteToolInput = z.infer<typeof InviteTool>;

const INVITE = defineAppAction<
  InviteInput,
  TeamOutcome<z.infer<typeof InviteResultDtoSchema>>,
  InviteToolInput
>({
  name: "team.invite",
  short: "invite a colleague",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Invites people by email to their company or firm with one role (Member or Admin), as Settings → Team does; the link lasts 7 days.",
  input: Invite,
  output: result(),
  authorize: ownOrganisation,
  run: (ports, context, input) =>
    team(ports).invite(context.actor, input.input, context.correlationId),
  targets: (input) => organisationTarget(input.organisationId),
  card: (input) => {
    const who = input.input.emails.join(", ");
    const role = input.input.role === "ADMIN" ? "Admin" : "Member";
    return {
      summary: `Invite ${who} to your team as ${role === "Admin" ? "an" : "a"} ${role}`,
      preview:
        input.input.message === undefined || input.input.message === ""
          ? `They get an email with a link to join. It works for 7 days.`
          : `They get an email with a link to join, with your note: "${input.input.message}"`,
    };
  },
  done: (out) => {
    if (!out.ok) return out.message;
    const sent = out.value.invited.filter((i) => i.emailed).length;
    const held = out.value.invited.length - sent;
    const skipped = out.value.skipped.length;
    return [
      sent > 0 ? `Invited ${String(sent)}. The link works for 7 days.` : null,
      held > 0
        ? `${String(held)} invitation${held === 1 ? "" : "s"} couldn't be emailed; resend from Settings → Team.`
        : null,
      skipped > 0
        ? `Skipped ${String(skipped)} (already on the team, already invited, or not an email address).`
        : null,
    ]
      .filter((line) => line !== null)
      .join(" ");
  },
  succeeded,
  http: {
    method: "POST",
    path: TEAM_INVITATIONS_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    status: 201,
    ...teamHttp((value: z.infer<typeof InviteResultDtoSchema>) =>
      InviteResultDtoSchema.parse(value),
    ),
  },
  tool: {
    name: "invite_colleague",
    purposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    description:
      "Prepares an invitation, for their approval, for a colleague or co-founder to join their company or firm on Capital Q by email, with one role: MEMBER (default) or ADMIN. Use only the email address they gave. Nothing is sent until they approve the card.",
    input: InviteTool,
    references: {},
    eval: {
      say: [
        "Invite tunde@korahealth.example to my company as an admin.",
        "Add my colleague nina@northbound.example to the team.",
      ],
    },
    toCanonical: (tool, context) => {
      if (context.actor.organisationId === undefined) {
        return Promise.resolve(
          refusal(
            "Set up your company or firm first; then you can invite people.",
          ),
        );
      }
      const parsed = InviteRequestSchema.safeParse({
        emails: tool.emails,
        role: tool.role,
        ...(tool.message === undefined ? {} : { message: tool.message }),
      });
      return Promise.resolve(
        parsed.success
          ? { organisationId: context.actor.organisationId, input: parsed.data }
          : refusal("I need a valid email address to send an invitation."),
      );
    },
  },
});

// --- change a role (Q: approval) -----------------------------------------

const Role = z
  .object({
    organisationId: OrganisationField,
    membershipId: UuidSchema,
    input: ChangeRoleRequestSchema,
    /** For the card only: who, as the team page names them. */
    name: z.string().max(200).optional(),
  })
  .strict();
type RoleInput = z.infer<typeof Role>;

const RoleTool = z
  .object({
    person: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The teammate, by name or email as they said it."),
    role: InvitableRoleSchema.describe(
      "ADMIN (can invite people and approve what Q sends) or MEMBER (works day to day).",
    ),
  })
  .strict();
type RoleToolInput = z.infer<typeof RoleTool>;

const roleWord = (role: string) => (role === "ADMIN" ? "an Admin" : "a Member");

/** One clear teammate by name or email; several or none is asked about. */
export function findTeammate(
  members: TeamDto["members"],
  said: string,
): TeamDto["members"][number] | string {
  const wanted = said.trim().toLowerCase();
  const exact = members.filter(
    (m) => m.name.toLowerCase() === wanted || m.email?.toLowerCase() === wanted,
  );
  const found =
    exact.length > 0
      ? exact
      : members.filter(
          (m) =>
            m.name.toLowerCase().includes(wanted) ||
            m.name
              .toLowerCase()
              .split(/\s+/u)
              .some((part) => part === wanted),
        );
  if (found.length === 1 && found[0] !== undefined) return found[0];
  return found.length === 0
    ? `I couldn't find ${said} on your team.`
    : `More than one person matches ${said}: ${found.map((m) => m.name).join(", ")}. Which one?`;
}

const SET_ROLE = defineAppAction<
  RoleInput,
  TeamOutcome<TeamDto>,
  RoleToolInput
>({
  name: "team.member.role.set",
  short: "change a teammate's role",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Changes a teammate's role between Admin and Member, as Settings → Team does. Owners change only through a hand-over.",
  input: Role,
  output: result(),
  authorize: ownOrganisation,
  run: (ports, context, input) =>
    team(ports).changeRole(
      context.actor,
      input.membershipId,
      input.input.role,
      context.correlationId,
    ),
  targets: (input) => organisationTarget(input.organisationId),
  supersedes: true,
  card: (input) => ({
    summary: `Make ${input.name ?? "them"} ${roleWord(input.input.role)}`,
    preview:
      input.input.role === "ADMIN"
        ? "Admins can invite people, change roles and approve what Q sends."
        : "Members work day to day; they can suggest, but can't approve what Q sends.",
  }),
  done: (out, input) =>
    teamDone(
      out,
      `${input.name ?? "They"} ${input.name === undefined ? "are" : "is"} now ${roleWord(input.input.role)}.`,
    ),
  succeeded,
  http: {
    method: "PUT",
    path: TEAM_MEMBER_ROLE_PATH,
    fromRequest: (params, body) => ({
      membershipId: params["membershipId"],
      input: body,
    }),
    ...teamHttp(toTeamDto),
  },
  tool: {
    name: "change_team_role",
    purposes: ["GENERAL_QUESTION", "ACTION_PREPARATION"],
    description:
      "Prepares, for their approval, a change of a teammate's role in their company or firm: ADMIN or MEMBER. Owners are not changed this way.",
    input: RoleTool,
    references: {},
    eval: {
      say: ["Make Sara an admin on my team.", "Change Tunde's role to member."],
      orSays: "couldn't find|isn't on your team|which one",
    },
    toCanonical: async (tool, context, ports) => {
      if (context.actor.organisationId === undefined) {
        return refusal("Set up your company or firm first.");
      }
      const current = await team(ports).team(context.actor);
      if (!current.ok) return refusal(current.message);
      const found = findTeammate(current.value.members, tool.person);
      if (typeof found === "string") return refusal(found);
      return {
        organisationId: context.actor.organisationId,
        membershipId: found.membershipId,
        input: { role: tool.role },
        name: found.name,
      };
    },
  },
});

// --- the rest: the person's own decisions, on the Team page --------------

const TEAM_PAGE = "offer.team_manage" as const;

const Invitation = z.object({ invitationId: UuidSchema }).strict();

const RESEND = defineAppAction<
  z.infer<typeof Invitation>,
  TeamOutcome<TeamDto>
>({
  name: "team.invitation.resend",
  short: "resend an invitation",
  area: "team",
  classification: "INSTANT",
  does: "Sends a pending invitation again with a new link that works for 7 days.",
  input: Invitation,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).resendInvitation(
      context.actor,
      input.invitationId,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Resend an invitation", preview: "" }),
  done: (out) => teamDone(out, "Sent again. The new link works for 7 days."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_INVITATION_RESEND_PATH,
    fromRequest: (params) => ({ invitationId: params["invitationId"] }),
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

const REVOKE = defineAppAction<
  z.infer<typeof Invitation>,
  TeamOutcome<TeamDto>
>({
  name: "team.invitation.revoke",
  short: "cancel an invitation",
  area: "team",
  classification: "INSTANT",
  does: "Cancels a pending invitation; its link stops working.",
  input: Invitation,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).revokeInvitation(
      context.actor,
      input.invitationId,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Cancel an invitation", preview: "" }),
  done: (out) => teamDone(out, "Cancelled. That link no longer works."),
  succeeded,
  http: {
    method: "DELETE",
    path: TEAM_INVITATION_PATH,
    fromRequest: (params) => ({ invitationId: params["invitationId"] }),
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

const Remove = z
  .object({ membershipId: UuidSchema, input: RemoveMemberRequestSchema })
  .strict();

const REMOVE = defineAppAction<z.infer<typeof Remove>, TeamOutcome<TeamDto>>({
  name: "team.member.remove",
  short: "remove a teammate",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Removes someone from their company or firm; they lose access at once, their work stays, and someone picks up their open work.",
  input: Remove,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).removeMember(
      context.actor,
      input.membershipId,
      input.input.handOverTo ?? null,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Remove a teammate", preview: "" }),
  done: (out) => teamDone(out, "Removed."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_MEMBER_REMOVE_PATH,
    fromRequest: (params, body) => ({
      membershipId: params["membershipId"],
      input: body ?? {},
    }),
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

const Leave = z.object({}).strict();

const LEAVE = defineAppAction<
  z.infer<typeof Leave>,
  TeamOutcome<z.infer<typeof LeaveResultDtoSchema>>
>({
  name: "team.leave",
  short: "leave my team",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Leaves their company or firm; never the last owner.",
  input: Leave,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context) =>
    team(ports).leave(context.actor, context.correlationId),
  targets: () => [],
  card: () => ({ summary: "Leave your team", preview: "" }),
  done: (out) => teamDone(out, "You left."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_LEAVE_PATH,
    fromRequest: () => ({}),
    ...teamHttp((value: z.infer<typeof LeaveResultDtoSchema>) =>
      LeaveResultDtoSchema.parse(value),
    ),
  },
  qCapability: TEAM_PAGE,
});

const Offer = z.object({ input: OwnershipOfferRequestSchema }).strict();

const OFFER = defineAppAction<z.infer<typeof Offer>, TeamOutcome<TeamDto>>({
  name: "team.ownership.offer",
  short: "make someone an owner",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Asks a teammate to become an owner too; they accept, then both are owners.",
  input: Offer,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).offerOwnership(
      context.actor,
      input.input.membershipId,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Make someone an owner", preview: "" }),
  done: (out) =>
    teamDone(out, "Request sent. Once they accept, you're both owners."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_OWNERSHIP_OFFERS_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    status: 201,
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

const Respond = z
  .object({ offerId: UuidSchema, input: OwnershipOfferResponseRequestSchema })
  .strict();

const RESPOND = defineAppAction<z.infer<typeof Respond>, TeamOutcome<TeamDto>>({
  name: "team.ownership.respond",
  short: "answer an ownership request",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Accepts or declines becoming an owner (or withdraws an offer they made).",
  input: Respond,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).respondToOwnershipOffer(
      context.actor,
      input.offerId,
      input.input.accept,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Answer an ownership request", preview: "" }),
  done: (out, input) =>
    teamDone(out, input.input.accept ? "You're an owner now." : "Declined."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_OWNERSHIP_OFFER_RESPONSE_PATH,
    fromRequest: (params, body) => ({
      offerId: params["offerId"],
      input: body,
    }),
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

const Decide = z
  .object({ requestId: UuidSchema, input: JoinRequestDecisionRequestSchema })
  .strict();

const DECIDE = defineAppAction<z.infer<typeof Decide>, TeamOutcome<TeamDto>>({
  name: "team.join_request.decide",
  short: "let someone in",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Lets in (as a Member) or declines someone who asked to join.",
  input: Decide,
  output: result(),
  authorize: () => Promise.resolve({ ok: true }),
  run: (ports, context, input) =>
    team(ports).decideJoinRequest(
      context.actor,
      input.requestId,
      input.input.approve,
      context.correlationId,
    ),
  targets: () => [],
  card: () => ({ summary: "Answer a request to join", preview: "" }),
  done: (out, input) =>
    teamDone(out, input.input.approve ? "Let in as a Member." : "Declined."),
  succeeded,
  http: {
    method: "POST",
    path: TEAM_JOIN_REQUEST_DECISION_PATH,
    fromRequest: (params, body) => ({
      requestId: params["requestId"],
      input: body,
    }),
    ...teamHttp(toTeamDto),
  },
  qCapability: TEAM_PAGE,
});

export const TEAM_ACTIONS: readonly AnyAppAction[] = [
  INVITE,
  SET_ROLE,
  RESEND,
  REVOKE,
  REMOVE,
  LEAVE,
  OFFER,
  RESPOND,
  DECIDE,
];

// --- person-scoped: before (or beside) any organisation ------------------

const Accept = z.object({ input: AcceptInvitationRequestSchema }).strict();

const ACCEPT = definePersonAction<
  z.infer<typeof Accept>,
  TeamOutcome<z.infer<typeof AcceptInvitationResultDtoSchema>>
>({
  name: "team.invitation.accept",
  short: "accept a team invitation",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Joins the company or firm an invitation is for, signed in as the invited email.",
  input: Accept,
  output: result(),
  run: (ports, context, input) =>
    team(ports).acceptInvitation(
      context.person.userId,
      input.input.token,
      context.correlationId,
    ),
  http: {
    method: "POST",
    path: INVITATION_ACCEPT_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    ...teamHttp((value: z.infer<typeof AcceptInvitationResultDtoSchema>) =>
      AcceptInvitationResultDtoSchema.parse(value),
    ),
  },
  qCapability: "offer.team_join",
});

const Join = z.object({ input: CreateJoinRequestSchema }).strict();

const JOIN = definePersonAction<
  z.infer<typeof Join>,
  TeamOutcome<{ readonly requested: true }>
>({
  name: "team.join_request.create",
  short: "ask to join a team",
  area: "team",
  classification: "CONSEQUENTIAL",
  does: "Asks the admins of a company or firm to let them in.",
  input: Join,
  output: result(),
  run: (ports, context, input) =>
    team(ports).requestToJoin(
      context.person.userId,
      input.input.organisationId,
      input.input.message ?? null,
      context.correlationId,
    ),
  http: {
    method: "POST",
    path: JOIN_REQUESTS_PATH,
    fromRequest: (_params, body) => ({ input: body }),
    status: 202,
    ...teamHttp((value: { readonly requested: true }) =>
      JoinRequestResultDtoSchema.parse(value),
    ),
  },
  qCapability: "offer.team_join",
});

export const TEAM_PERSON_ACTIONS: readonly AnyPersonAction[] = [ACCEPT, JOIN];

// --- read_my("team") -------------------------------------------------------

const ROLE_WORDS = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
} as const;

/** Their team as the Team page shows it: people with roles, then invitations. */
export async function teamItems(
  ports: AppActionPorts,
  actor: AppActionContext["actor"],
): Promise<readonly OwnReadItem[] | null> {
  if (ports.team === undefined) return null;
  if (actor.organisationId === undefined) return [];
  const out = await ports.team.team(actor);
  if (!out.ok) return [];
  const word = out.value.organisation.kind === "COMPANY" ? "company" : "firm";
  return [
    ...out.value.members.map((member) => ({
      id: member.membershipId,
      title: member.isYou ? `${member.name} (you)` : member.name,
      status: ROLE_WORDS[member.role],
      at: member.joinedAt,
      facts: {
        team: out.value.organisation.name,
        kind: word,
        email: member.email,
        title: member.title,
      },
    })),
    ...out.value.invitations.map((invitation) => ({
      id: invitation.invitationId,
      title: invitation.email,
      status:
        invitation.state === "EXPIRED"
          ? `invited as ${ROLE_WORDS[invitation.role]}; the link expired`
          : `invited as ${ROLE_WORDS[invitation.role]}; waiting`,
      at: invitation.sentAt,
      facts: { team: out.value.organisation.name, kind: word },
    })),
  ];
}
