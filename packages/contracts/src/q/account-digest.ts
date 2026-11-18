import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  RELATIONSHIP_NEXT_STEPS,
  RelationshipStateV2Schema,
} from "../http/relationships.js";
import { QAttentionItemSchema } from "./attention.js";

/**
 * Owner requirement 14 Nov 2026 (audit 2026-11-14 P0 #2, D1): every Q turn,
 * typed or spoken, knows what is happening in the asking person's account
 * before any lane answers -- their relationships by stage and what is owed
 * on each, approvals waiting on them, calls in the next two weeks, Q's work
 * and open requests, GateQ applications and what changed lately.
 *
 * Assembled by code (q-tools `createAccountDigestReader`) from the same
 * read models their pages and Q's tools read, for the resolved actor only:
 * nothing about another tenant, and nothing founder-private reaches an
 * investor's digest (each read is the person's own side's projection). No
 * model call. Bounded: every list has a cap and the digest says how many
 * it left out. A section that could not be read is in `unread`, never
 * reported as empty.
 *
 * `GET`: the person's own digest (the resume opening reads it).
 */
export const Q_ACCOUNT_DIGEST_PATH = "/v1/q/account-digest" as const;

export const ACCOUNT_DIGEST_RELATIONSHIPS_MAX = 12;
export const ACCOUNT_DIGEST_WAITING_MAX = 10;
export const ACCOUNT_DIGEST_MEETINGS_MAX = 8;
export const ACCOUNT_DIGEST_WORK_MAX = 6;
export const ACCOUNT_DIGEST_REQUESTS_MAX = 5;
export const ACCOUNT_DIGEST_APPLICATIONS_MAX = 6;
export const ACCOUNT_DIGEST_RECENT_MAX = 6;
/** Upcoming calls are those in the next fourteen days. */
export const ACCOUNT_DIGEST_MEETING_DAYS = 14;
/** Recent events are those in the last three days. */
export const ACCOUNT_DIGEST_RECENT_DAYS = 3;

export const ACCOUNT_DIGEST_SECTIONS = [
  "RELATIONSHIPS",
  "WAITING",
  "MEETINGS",
  "WORK",
  "REQUESTS",
  "GATEQ",
] as const;
export const AccountDigestSectionSchema = z.enum(ACCOUNT_DIGEST_SECTIONS);
export type AccountDigestSection = z.infer<typeof AccountDigestSectionSchema>;

/**
 * What is owed in a relationship's conversation, by side:
 * YOU_OWE_REPLY -- they wrote last and wait for the person;
 * AWAITING_THEM -- the person wrote last, or asked, and waits for them;
 * null -- nothing owed, or the thread could not be read (never guessed).
 */
export const AccountDigestOwedSchema = z.enum([
  "YOU_OWE_REPLY",
  "AWAITING_THEM",
]);
export type AccountDigestOwed = z.infer<typeof AccountDigestOwedSchema>;

/**
 * One relationship's stage, as the projection holds it: compact, since
 * every relationship carries one (the listed few carry the full row).
 */
export const AccountDigestStageSchema = z
  .object({
    counterpartId: UuidSchema,
    name: z.string().min(1).max(60),
    stage: RelationshipStateV2Schema,
  })
  .strict();
export type AccountDigestStage = z.infer<typeof AccountDigestStageSchema>;

export const AccountDigestRelationshipSchema = z
  .object({
    relationshipId: UuidSchema,
    counterpart: z
      .object({
        kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
        id: UuidSchema,
        name: z.string().min(1).max(120),
      })
      .strict(),
    stage: RelationshipStateV2Schema,
    stageSince: z.string().datetime({ offset: true }),
    nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
    owed: AccountDigestOwedSchema.nullable(),
    /** When the last message in the thread was written; null: none or unread. */
    lastMessageAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AccountDigestRelationship = z.infer<
  typeof AccountDigestRelationshipSchema
>;

export const AccountDigestMeetingSchema = z
  .object({
    id: z.string().min(1).max(80),
    relationshipId: z.string().max(80).nullable(),
    purpose: z.string().max(160),
    startsAt: z.string().datetime({ offset: true }),
    /** The meeting's own IANA zone, as stored. */
    timeZone: z.string().max(64).nullable(),
    with: z.array(z.string().max(120)).max(4),
    hasBrief: z.boolean(),
  })
  .strict();
export type AccountDigestMeeting = z.infer<typeof AccountDigestMeetingSchema>;

export const AccountDigestWorkSchema = z
  .object({
    id: UuidSchema,
    kind: z.string().max(40),
    status: z.string().max(20),
    goal: z.string().max(160),
    /** Lanes still in progress (outreach), when the work has lanes. */
    open: z.number().int().min(0).max(100),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type AccountDigestWork = z.infer<typeof AccountDigestWorkSchema>;

/** Diligence requests open in one relationship, and which way they run. */
export const AccountDigestRequestSchema = z
  .object({
    relationshipId: UuidSchema,
    counterpart: z.string().min(1).max(120),
    /** TO_YOU: the counterpart asked the person; FROM_YOU: the person asked. */
    direction: z.enum(["TO_YOU", "FROM_YOU"]),
    open: z.array(z.string().max(160)).max(3),
    openCount: z.number().int().min(0).max(500),
    answeredCount: z.number().int().min(0).max(500),
  })
  .strict();
export type AccountDigestRequest = z.infer<typeof AccountDigestRequestSchema>;

/** A founder's own submitted GateQ application, as their GateQ page shows it. */
export const AccountDigestApplicationSchema = z
  .object({
    applicationId: UuidSchema,
    fund: z.string().min(1).max(120),
    status: z.enum(["SENT", "REPLIED", "PASSED"]),
    sentAt: z.string().datetime({ offset: true }),
    replyBy: z.string().max(40).nullable(),
  })
  .strict();

/** An investor's GateQ inbox, as counts and the few that need judgement. */
export const AccountDigestInboxSchema = z
  .object({
    gatewayName: z.string().min(1).max(120),
    unread: z.number().int().min(0),
    fits: z.number().int().min(0),
    partial: z.number().int().min(0),
    notAFit: z.number().int().min(0),
    /** In the inbox, not answered, and a reply promise is running. */
    needsJudgement: z.number().int().min(0),
    top: z
      .array(
        z
          .object({
            applicationId: UuidSchema,
            companyName: z.string().min(1).max(120),
            fit: z.string().max(20),
            daysLeft: z.number().int().nullable(),
          })
          .strict(),
      )
      .max(3),
    /**
     * Every applicant's company name in the inbox: a GateQ application is
     * contact (owner 18 Nov 2026), named as the inbox names it.
     */
    applicants: z.array(z.string().min(1).max(120)).max(100).optional(),
  })
  .strict();
export type AccountDigestInbox = z.infer<typeof AccountDigestInboxSchema>;

export const AccountDigestGateqSchema = z
  .object({
    applications: z
      .array(AccountDigestApplicationSchema)
      .max(ACCOUNT_DIGEST_APPLICATIONS_MAX),
    applicationsTotal: z.number().int().min(0),
    inbox: AccountDigestInboxSchema.nullable(),
  })
  .strict();
export type AccountDigestGateq = z.infer<typeof AccountDigestGateqSchema>;

export const AccountDigestEventSchema = z
  .object({
    at: z.string().datetime({ offset: true }),
    /** Plain words: "Ledgerline moved to In diligence". */
    text: z.string().min(1).max(200),
    relationshipId: UuidSchema.nullable(),
  })
  .strict();
export type AccountDigestEvent = z.infer<typeof AccountDigestEventSchema>;

export const QAccountDigestSchema = z
  .object({
    side: z.enum(["INVESTOR", "COMPANY"]).nullable(),
    relationships: z
      .array(AccountDigestRelationshipSchema)
      .max(ACCOUNT_DIGEST_RELATIONSHIPS_MAX),
    relationshipsTotal: z.number().int().min(0),
    /** Count per stage over all their relationships, not only those listed. */
    byStage: z.partialRecord(
      RelationshipStateV2Schema,
      z.number().int().min(0),
    ),
    /**
     * Every relationship counterpart id (companies or investor
     * organisations), uncapped up to the read's own bound: what a stated
     * "not the ones I'm already in touch with" excludes.
     */
    relationshipCounterpartIds: z.array(UuidSchema).max(200),
    /**
     * Owner live 18 Nov 2026 (conversation b0719e94): every relationship
     * with its stage from the projection, not only the twelve listed, so
     * "am I connected with Nixo?" and "leave out the ones I'm in touch
     * with" read the same stage for every counterpart (Nixo, INVESTED, was
     * not among the twelve listed).
     */
    relationshipStages: z.array(AccountDigestStageSchema).max(200).optional(),
    waiting: z.array(QAttentionItemSchema).max(ACCOUNT_DIGEST_WAITING_MAX),
    waitingTotal: z.number().int().min(0),
    meetings: z
      .array(AccountDigestMeetingSchema)
      .max(ACCOUNT_DIGEST_MEETINGS_MAX),
    work: z.array(AccountDigestWorkSchema).max(ACCOUNT_DIGEST_WORK_MAX),
    requests: z
      .array(AccountDigestRequestSchema)
      .max(ACCOUNT_DIGEST_REQUESTS_MAX),
    gateq: AccountDigestGateqSchema.nullable(),
    recent: z.array(AccountDigestEventSchema).max(ACCOUNT_DIGEST_RECENT_MAX),
    unread: z.array(AccountDigestSectionSchema),
    readAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type QAccountDigest = z.infer<typeof QAccountDigestSchema>;
