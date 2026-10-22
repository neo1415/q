import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { TeamAbilitiesSchema, TeamRoleSchema } from "./team.js";

/**
 * Organisation administration reads (owner/admin backend).
 *
 * - GET /v1/me/capabilities                         what the caller may do in
 *                                                   their ACTIVE organisation
 * - GET /v1/organisation/activity                   the organisation's activity
 *                                                   feed (organisation.activity.view)
 * - GET /v1/organisation/members/:userId/summary    one member, for admins
 *
 * Every route acts on the caller's active organisation, resolved on the
 * server. No path, query or body names the organisation.
 *
 * What these never carry: the contents of anyone's Q conversations, Q
 * memory, delegations, workforce jobs, standing instructions, reminders or
 * chats. Those are personal_private by design. The feed may say that Q
 * carried out an approved action under a member's authority, because that
 * is already an accountability fact (audit.material_actions).
 */

export const ME_CAPABILITIES_PATH = "/v1/me/capabilities" as const;
export const ORGANISATION_ACTIVITY_PATH = "/v1/organisation/activity" as const;
export const ORGANISATION_MEMBER_SUMMARY_PATH =
  "/v1/organisation/members/:userId/summary" as const;

/** The capability that opens the activity feed and member summaries. */
export const ORGANISATION_ACTIVITY_VIEW = "organisation.activity.view" as const;

export const MeCapabilitiesDtoSchema = z
  .object({
    organisationId: UuidSchema,
    membershipId: UuidSchema,
    role: TeamRoleSchema,
    /**
     * Capabilities held over the active organisation, sorted. Resolved from
     * server-side policy facts; never echoed from the client.
     */
    capabilities: z.array(z.string().min(3).max(128)).max(256),
    team: TeamAbilitiesSchema,
  })
  .strict();
export type MeCapabilitiesDto = z.infer<typeof MeCapabilitiesDtoSchema>;

// ---------------------------------------------------------------------------
// Activity vocabulary: stable codes, mapped to plain words on the server.
// ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = [
  "TEAM",
  "ORGANISATION",
  "PROFILE",
  "RELATIONSHIPS",
  "MESSAGES",
  "MEETINGS",
  "DOCUMENTS",
  "SHARING",
  "CAPITAL",
  "MANDATE",
  "MEDIA",
  "VERIFICATION",
  "OTHER",
] as const;
export const ActivityKindSchema = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

/** Known actions. Anything else is `other`, described by its kind. */
export const ACTIVITY_ACTION_CODES = [
  "team.invitation.sent",
  "team.invitation.resent",
  "team.invitation.revoked",
  "team.invitation.accepted",
  "team.invitation.declined",
  "team.membership.role_changed",
  "team.membership.removed",
  "team.membership.left",
  "team.membership.admitted_by_claim",
  "team.ownership.offered",
  "team.ownership.accepted",
  "team.ownership.declined",
  "team.join_request.created",
  "team.join_request.approved",
  "team.join_request.declined",
  "organisation.created",
  "organisation.updated",
  "company.profile.update",
  "person.profile.update",
  "relationship.interest.express",
  "relationship.interest.respond",
  "relationship.connection_request.send",
  "relationship.connection_request.respond",
  "relationship.deal_terms_recorded",
  "relationship.deal.change",
  "relationship.note.add",
  "relationship.note.correct",
  "relationship.stage.change",
  "message.send",
  "email.send",
  "meeting.schedule",
  "meeting.reschedule",
  "meeting.book",
  "meeting.proposal.accept",
  "document.share",
  "document.deck_audience.set",
  "diligence.change",
  "raise.share",
  "raise.unshare",
  "disclosure.share.revoke",
  "capital.objective.change",
  "capital.commitment.confirm_amount",
  "investor.mandate.change",
  "pitch.details.set",
  "media.change",
  "verification.decided",
  "other",
] as const;
export const ActivityActionCodeSchema = z.enum(ACTIVITY_ACTION_CODES);
export type ActivityActionCode = z.infer<typeof ActivityActionCodeSchema>;

export const ActivityActorSchema = z
  .object({
    type: z.enum(["PERSON", "Q", "CAPITAL_Q", "CONNECTED_SYSTEM"]),
    /** The person who acted, or under whose approval Q acted. */
    userId: UuidSchema.nullable(),
    /** Ready to show: "Sara Kimani", "Q, under Sara Kimani's approval". */
    display: z.string().min(1).max(260),
  })
  .strict();
export type ActivityActor = z.infer<typeof ActivityActorSchema>;

export const ActivityResourceSchema = z
  .object({
    /** A stable lowercase kind: membership, company, relationship, document... */
    kind: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .max(64),
    /**
     * A label safe for this admin: a name only where an existing authorised
     * read already shows it to them; otherwise generic ("a document").
     */
    label: z.string().min(1).max(260),
    /** An in-app path the admin may open, or null. */
    link: z.string().startsWith("/").max(300).nullable(),
  })
  .strict();
export type ActivityResource = z.infer<typeof ActivityResourceSchema>;

/** A before -> after summary, only where the source already stores it. */
export const ActivityChangeSchema = z
  .object({
    before: z.string().max(300).nullable(),
    after: z.string().max(300).nullable(),
  })
  .strict();

export const ActivityItemDtoSchema = z
  .object({
    id: UuidSchema,
    at: z.string(),
    actor: ActivityActorSchema,
    action: z
      .object({
        code: ActivityActionCodeSchema,
        kind: ActivityKindSchema,
        words: z.string().min(1).max(200),
      })
      .strict(),
    outcome: z.enum(["SUCCEEDED", "FAILED", "DENIED"]),
    resource: ActivityResourceSchema,
    change: ActivityChangeSchema.nullable(),
  })
  .strict();
export type ActivityItemDto = z.infer<typeof ActivityItemDtoSchema>;

export const ACTIVITY_PAGE_MAX = 100;
export const ACTIVITY_PAGE_DEFAULT = 50;

export const ActivityQuerySchema = z
  .object({
    /** A person who is, or was, a member of the caller's organisation. */
    member: UuidSchema.optional(),
    kind: ActivityKindSchema.optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).optional(),
  })
  .strict();
export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;

export const ActivityPageDtoSchema = z
  .object({
    items: z.array(ActivityItemDtoSchema).max(ACTIVITY_PAGE_MAX),
    nextCursor: z.string().max(200).nullable(),
  })
  .strict();
export type ActivityPageDto = z.infer<typeof ActivityPageDtoSchema>;

// ---------------------------------------------------------------------------
// One member, for admins.
// ---------------------------------------------------------------------------

export const MemberSummaryDtoSchema = z
  .object({
    member: z
      .object({
        userId: UuidSchema,
        membershipId: UuidSchema,
        name: z.string().min(1).max(200),
        email: z.string().max(254).nullable(),
        status: z.enum(["ACTIVE", "LEFT", "REMOVED"]),
        /** Their role now; null once they are no longer a member. */
        role: TeamRoleSchema.nullable(),
        joinedAt: z.string(),
        leftAt: z.string().nullable(),
      })
      .strict(),
    roleHistory: z
      .array(
        z
          .object({
            role: TeamRoleSchema,
            from: z.string(),
            until: z.string().nullable(),
          })
          .strict(),
      )
      .max(200),
    invitationsSent: z
      .array(
        z
          .object({
            invitationId: UuidSchema,
            email: z.string().max(254),
            role: z.enum(["ADMIN", "MEMBER"]),
            state: z.enum([
              "PENDING",
              "EXPIRED",
              "ACCEPTED",
              "REVOKED",
              "DECLINED",
            ]),
            sentAt: z.string(),
          })
          .strict(),
      )
      .max(200),
    /** Their latest material action for this organisation, or null. */
    lastActiveAt: z.string().nullable(),
    last30Days: z
      .object({
        since: z.string(),
        counts: z.array(
          z
            .object({
              kind: ActivityKindSchema,
              count: z.number().int().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    /** Relationships they touched on this organisation's side only. */
    relationships: z
      .array(
        z
          .object({
            relationshipId: UuidSchema,
            label: z.string().min(1).max(260),
            link: z.string().startsWith("/").max(300).nullable(),
            lastTouchedAt: z.string(),
            events: z.number().int().min(0),
            notes: z.number().int().min(0),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type MemberSummaryDto = z.infer<typeof MemberSummaryDtoSchema>;
