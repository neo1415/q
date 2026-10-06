import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { OrganisationTypeSchema } from "./organisations.js";

/**
 * G1/G2: an organisation as a team. A founder's company and an investor's
 * firm are organisations; the UI says "Company" or "Firm", never
 * "organisation". One person alone is their own organisation.
 *
 * Every team route acts on the caller's ACTIVE organisation, resolved on
 * the server from their membership; nothing in a path or body names the
 * organisation they act for (no client-supplied trust).
 *
 * - GET    /v1/team                                     the team page
 * - POST   /v1/team/invitations                         invite by email (app action)
 * - POST   /v1/team/invitations/:invitationId/resend    new link, new expiry
 * - DELETE /v1/team/invitations/:invitationId           revoke
 * - PUT    /v1/team/members/:membershipId/role          Admin <-> Member (or step down)
 * - POST   /v1/team/members/:membershipId/remove        remove someone
 * - POST   /v1/team/leave                               leave (never the last owner)
 * - POST   /v1/team/ownership-offers                    offer ownership
 * - POST   /v1/team/ownership-offers/:offerId/response  accept or decline it
 * - POST   /v1/team/join-requests/:requestId/decision   let in or decline
 * - GET    /v1/me/organisations                         the switcher's list
 * - GET    /v1/invitations/preview                      what a link invites to
 *                                                       (token in a header)
 * - POST   /v1/invitations/accept                       accept, as the invited email
 * - POST   /v1/join-requests                            ask to join
 */

export const TEAM_PATH = "/v1/team" as const;
export const TEAM_INVITATIONS_PATH = "/v1/team/invitations" as const;
export const TEAM_INVITATION_PATH =
  "/v1/team/invitations/:invitationId" as const;
export const TEAM_INVITATION_RESEND_PATH =
  "/v1/team/invitations/:invitationId/resend" as const;
export const TEAM_MEMBER_ROLE_PATH =
  "/v1/team/members/:membershipId/role" as const;
export const TEAM_MEMBER_REMOVE_PATH =
  "/v1/team/members/:membershipId/remove" as const;
export const TEAM_LEAVE_PATH = "/v1/team/leave" as const;
export const TEAM_OWNERSHIP_OFFERS_PATH = "/v1/team/ownership-offers" as const;
export const TEAM_OWNERSHIP_OFFER_RESPONSE_PATH =
  "/v1/team/ownership-offers/:offerId/response" as const;
export const TEAM_JOIN_REQUEST_DECISION_PATH =
  "/v1/team/join-requests/:requestId/decision" as const;
export const MY_ORGANISATIONS_PATH = "/v1/me/organisations" as const;
export const INVITATION_PREVIEW_PATH = "/v1/invitations/preview" as const;
export const INVITATION_ACCEPT_PATH = "/v1/invitations/accept" as const;
export const JOIN_REQUESTS_PATH = "/v1/join-requests" as const;

/** The link token travels in this header for a preview, never in a URL the API logs. */
export const INVITATION_TOKEN_HEADER = "x-invitation-token" as const;

/** How long an invitation link works. */
export const INVITATION_TTL_DAYS = 7;
/** Most addresses one invitation request may hold. */
export const INVITE_EMAILS_MAX = 20;

export const TEAM_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export const TeamRoleSchema = z.enum(TEAM_ROLES);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

/** Owners are never invited; ownership is offered and accepted. */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER"] as const;
export const InvitableRoleSchema = z.enum(INVITABLE_ROLES);
export type InvitableRole = z.infer<typeof InvitableRoleSchema>;

/** The word the UI uses: a founder's company, an investor's firm. */
export const TeamKindSchema = z.enum(["COMPANY", "FIRM"]);
export type TeamKind = z.infer<typeof TeamKindSchema>;

export const TeamOrganisationDtoSchema = z
  .object({
    organisationId: UuidSchema,
    name: z.string().min(1).max(200),
    kind: TeamKindSchema,
    organisationType: OrganisationTypeSchema,
  })
  .strict();

export const TeamMemberDtoSchema = z
  .object({
    membershipId: UuidSchema,
    userId: UuidSchema,
    name: z.string().min(1).max(200),
    email: z.string().max(254).nullable(),
    title: z.string().max(120).nullable(),
    role: TeamRoleSchema,
    isYou: z.boolean(),
    joinedAt: z.string(),
  })
  .strict();
export type TeamMemberDto = z.infer<typeof TeamMemberDtoSchema>;

export const TeamInvitationDtoSchema = z
  .object({
    invitationId: UuidSchema,
    email: z.string().max(254),
    role: InvitableRoleSchema,
    state: z.enum(["PENDING", "EXPIRED"]),
    sentAt: z.string(),
    sentCount: z.number().int().min(1),
    expiresAt: z.string(),
    invitedByName: z.string().max(200).nullable(),
  })
  .strict();
export type TeamInvitationDto = z.infer<typeof TeamInvitationDtoSchema>;

export const TeamJoinRequestDtoSchema = z
  .object({
    requestId: UuidSchema,
    name: z.string().min(1).max(200),
    email: z.string().max(254).nullable(),
    message: z.string().max(500).nullable(),
    requestedAt: z.string(),
  })
  .strict();
export type TeamJoinRequestDto = z.infer<typeof TeamJoinRequestDtoSchema>;

export const TeamOwnershipOfferDtoSchema = z
  .object({
    offerId: UuidSchema,
    fromName: z.string().max(200),
    toMembershipId: UuidSchema,
    toName: z.string().max(200),
    /** TO_YOU: theirs to accept; FROM_YOU: theirs to wait on. */
    direction: z.enum(["TO_YOU", "FROM_YOU", "OTHER"]),
    offeredAt: z.string(),
  })
  .strict();
export type TeamOwnershipOfferDto = z.infer<typeof TeamOwnershipOfferDtoSchema>;

/** What the caller may do here, decided on the server from their role. */
export const TeamAbilitiesSchema = z
  .object({
    invite: z.boolean(),
    changeRoles: z.boolean(),
    removeMembers: z.boolean(),
    own: z.boolean(),
  })
  .strict();

export const TeamDtoSchema = z
  .object({
    organisation: TeamOrganisationDtoSchema,
    you: z
      .object({
        membershipId: UuidSchema,
        role: TeamRoleSchema,
        can: TeamAbilitiesSchema,
      })
      .strict(),
    ownerCount: z.number().int().min(0),
    members: z.array(TeamMemberDtoSchema),
    /** Empty unless they may invite. */
    invitations: z.array(TeamInvitationDtoSchema),
    /** Empty unless they may let people in. */
    joinRequests: z.array(TeamJoinRequestDtoSchema),
    ownershipOffers: z.array(TeamOwnershipOfferDtoSchema),
  })
  .strict();
export type TeamDto = z.infer<typeof TeamDtoSchema>;

export const InviteRequestSchema = z
  .object({
    emails: z.array(z.string().trim().min(3).max(254)).min(1).max(INVITE_EMAILS_MAX),
    role: InvitableRoleSchema,
    message: z.string().trim().max(500).optional(),
  })
  .strict();
export type InviteRequest = z.infer<typeof InviteRequestSchema>;

export const InviteSkipReasonSchema = z.enum([
  "INVALID_EMAIL",
  "ALREADY_MEMBER",
  "ALREADY_INVITED",
]);

export const InviteResultDtoSchema = z
  .object({
    invited: z.array(
      z
        .object({
          invitationId: UuidSchema,
          email: z.string(),
          /** False: the invitation exists but the email did not go; resend it. */
          emailed: z.boolean(),
        })
        .strict(),
    ),
    skipped: z.array(
      z.object({ email: z.string(), reason: InviteSkipReasonSchema }).strict(),
    ),
    team: TeamDtoSchema,
  })
  .strict();
export type InviteResultDto = z.infer<typeof InviteResultDtoSchema>;

export const ChangeRoleRequestSchema = z
  .object({ role: InvitableRoleSchema })
  .strict();
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequestSchema>;

export const RemoveMemberRequestSchema = z
  .object({
    /** Who picks up their open work; default the person removing them. */
    handOverTo: UuidSchema.nullable().optional(),
  })
  .strict();
export type RemoveMemberRequest = z.infer<typeof RemoveMemberRequestSchema>;

export const OwnershipOfferRequestSchema = z
  .object({ membershipId: UuidSchema })
  .strict();
export const OwnershipOfferResponseRequestSchema = z
  .object({ accept: z.boolean() })
  .strict();
export const JoinRequestDecisionRequestSchema = z
  .object({ approve: z.boolean() })
  .strict();

export const LeaveResultDtoSchema = z
  .object({
    left: z.literal(true),
    /** The organisation they now act for, if they have another. */
    nowActingFor: UuidSchema.nullable(),
  })
  .strict();
export type LeaveResultDto = z.infer<typeof LeaveResultDtoSchema>;

export const MyOrganisationDtoSchema = z
  .object({
    organisationId: UuidSchema,
    name: z.string().min(1).max(200),
    kind: TeamKindSchema,
    organisationType: OrganisationTypeSchema,
    role: TeamRoleSchema,
    memberCount: z.number().int().min(0),
    active: z.boolean(),
  })
  .strict();
export type MyOrganisationDto = z.infer<typeof MyOrganisationDtoSchema>;

export const MyOrganisationsDtoSchema = z
  .object({ items: z.array(MyOrganisationDtoSchema) })
  .strict();
export type MyOrganisationsDto = z.infer<typeof MyOrganisationsDtoSchema>;

export const InvitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32,128}$/u);

export const InvitationPreviewDtoSchema = z
  .object({
    state: z.enum(["PENDING", "EXPIRED", "ACCEPTED", "REVOKED"]),
    organisationName: z.string().max(200),
    kind: TeamKindSchema,
    role: InvitableRoleSchema,
    /** The address it was sent to: whoever holds the link was sent it. */
    email: z.string().max(254),
    invitedByName: z.string().max(200).nullable(),
    memberCount: z.number().int().min(0),
    /** A few of the people already there, by initials only. */
    memberInitials: z.array(z.string().max(4)).max(4),
  })
  .strict();
export type InvitationPreviewDto = z.infer<typeof InvitationPreviewDtoSchema>;

export const AcceptInvitationRequestSchema = z
  .object({ token: InvitationTokenSchema })
  .strict();

export const AcceptInvitationResultDtoSchema = z
  .object({
    organisationId: UuidSchema,
    name: z.string(),
    kind: TeamKindSchema,
    role: TeamRoleSchema,
  })
  .strict();
export type AcceptInvitationResultDto = z.infer<
  typeof AcceptInvitationResultDtoSchema
>;

export const CreateJoinRequestSchema = z
  .object({
    organisationId: UuidSchema,
    message: z.string().trim().max(500).optional(),
  })
  .strict();

export const JoinRequestResultDtoSchema = z
  .object({ requested: z.literal(true) })
  .strict();
