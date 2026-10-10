import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  RelationshipMilestoneDtoSchema,
  RelationshipStateV2Schema,
  RELATIONSHIP_NEXT_STEPS,
} from "./relationships.js";

/**
 * The Relationship Brief (R1, founder 2026-10-09: Q said "no message has
 * been sent" to TensorGate while the thread held twelve messages and a
 * booked call).
 *
 * One read model for "where do we stand with X", for Q's relationship
 * tools, the relationship screen and the attention summary alike. It is
 * assembled by the Network context for the asking party only, after that
 * party's own authorization, from the sources that already own each fact.
 *
 * Every source says whether it was read. UNAVAILABLE means "not known
 * right now", never "none": a failed read must not be presented as an
 * empty history (the TensorGate failure was exactly that conflation).
 */

const unavailable = z
  .object({
    status: z.literal("UNAVAILABLE"),
    /** NOT_COMPOSED: this deployment does not wire the source. */
    reason: z.enum(["READ_FAILED", "NOT_COMPOSED"]),
  })
  .strict();

function source<T extends z.ZodRawShape>(shape: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("OK"), ...shape }).strict(),
    unavailable,
  ]);
}

export const RelationshipBriefSideSchema = z.enum(["INVESTOR", "COMPANY"]);

export const RelationshipBriefMessageSchema = z
  .object({
    /** From the asker's side: YOU, a colleague on YOUR_SIDE, or the OTHER_SIDE. */
    from: z.enum(["YOU", "YOUR_SIDE", "OTHER_SIDE"]),
    senderName: z.string().max(200),
    kind: z.enum(["TEXT", "ATTACHMENT", "VOICE_NOTE"]),
    /**
     * SENT: stored on the thread and visible to both sides. Capital Q keeps
     * no read receipts, so nothing stronger is claimed.
     */
    delivery: z.literal("SENT"),
    /** Sent by Q on the person's approval or delegation. */
    viaQ: z.boolean(),
    sentAt: UtcTimestampSchema,
    /**
     * A bounded preview of the message as it stands now, for the asking
     * party's own thread only. Null: not read (Q's single brief omits it).
     */
    preview: z.string().max(240).nullable().default(null),
  })
  .strict();

export const RelationshipBriefMeetingSchema = z
  .object({
    id: UuidSchema,
    status: z.enum(["SCHEDULING", "SCHEDULED", "CANCELLED", "FAILED"]),
    startsAt: UtcTimestampSchema,
    endsAt: UtcTimestampSchema,
    /** Relative to the brief's generatedAt. */
    timing: z.enum(["UPCOMING", "PAST"]),
    organisedByYou: z.boolean(),
    /** A meeting_no_show was recorded for this call on the history. */
    noShow: z.boolean().default(false),
  })
  .strict();

export const RelationshipBriefDecisionSchema = z
  .object({
    kind: z.enum([
      "ANSWER_INTEREST",
      "AWAIT_ANSWER",
      "EXPRESS_INTEREST",
      "REPLY_TO_MESSAGE",
      "SCHEDULE_MEETING",
      "ATTEND_MEETING",
      "DECIDE_NEXT_STEP",
      "FOLLOW_UP",
      "RESUME",
    ]),
    /** Whose move it is. */
    owner: z.enum(["YOU", "THEM"]),
    /** When the basis of the decision was recorded. */
    since: UtcTimestampSchema.nullable(),
  })
  .strict();

export const RelationshipBriefSchema = z
  .object({
    relationshipId: UuidSchema,
    yourSide: RelationshipBriefSideSchema,
    counterparty: z
      .object({
        kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
        id: UuidSchema,
        /** Null: the canonical record's name could not be read. */
        name: z.string().max(200).nullable(),
      })
      .strict(),
    generatedAt: UtcTimestampSchema,
    /**
     * The deterministic projector's fold over the history this side may
     * see. Null: nothing on record this side may see.
     */
    state: z
      .object({
        state: RelationshipStateV2Schema,
        stateSince: UtcTimestampSchema,
        milestones: z.array(RelationshipMilestoneDtoSchema).max(64),
        nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
      })
      .strict()
      .nullable(),
    /**
     * Messages on the relationship thread. `count` is the number of
     * message_sent events in the history this side may see -- the same
     * read as `state`, so it is known whenever the brief exists and never
     * depends on a summary. `latest` is read from the thread itself.
     */
    messages: z
      .object({
        count: z.number().int().min(0),
        latest: source({
          message: RelationshipBriefMessageSchema.nullable(),
          /** The other side's latest message (null: they have not written). */
          fromThem: RelationshipBriefMessageSchema.nullable(),
        }),
      })
      .strict(),
    /**
     * Calls recorded as not having taken place (meeting_no_show), from the
     * same history as `state`: known whenever the brief exists.
     */
    noShows: z
      .array(
        z.object({ meetingId: UuidSchema, at: UtcTimestampSchema }).strict(),
      )
      .max(20)
      .default([]),
    meetings: source({
      items: z.array(RelationshipBriefMeetingSchema).max(50),
      /** The next SCHEDULED call still ahead, if any. */
      nextScheduled: RelationshipBriefMeetingSchema.nullable(),
    }),
    /** Whose move it is, derived by code from the sources above. */
    pendingDecisions: z
      .object({
        items: z.array(RelationshipBriefDecisionSchema).max(10),
        /** False when a source behind a decision was UNAVAILABLE. */
        complete: z.boolean(),
      })
      .strict(),
    /** Diligence requests still open on the relationship. */
    obligations: source({
      openRequests: z
        .array(
          z.object({ id: UuidSchema, title: z.string().max(200) }).strict(),
        )
        .max(50),
      answeredCount: z.number().int().min(0),
    }),
    /** Documents shared into the relationship, as this side may see them. */
    documents: source({
      items: z
        .array(
          z
            .object({
              id: UuidSchema,
              title: z.string().max(300),
              /** Investor side: whether anyone on this side opened it. Null: not tracked for this side. */
              openedByYourSide: z.boolean().nullable().default(null),
            })
            .strict(),
        )
        .max(50),
    }),
    sourceVersions: z
      .object({
        projector: z.string().max(64).nullable(),
        historySequence: z.number().int().min(0),
        brief: z.literal("relationship-brief.v1"),
      })
      .strict(),
  })
  .strict();
export type RelationshipBrief = z.infer<typeof RelationshipBriefSchema>;

/**
 * Every relationship brief this viewer may read, in one call (R1
 * batching): the list screens' cards read this instead of a thread, a
 * schedule and a diligence call per relationship.
 */
export const NETWORK_RELATIONSHIP_BRIEFS_PATH =
  "/v1/network/relationship-briefs" as const;
export const RELATIONSHIP_BRIEFS_MAX = 50;
export const RelationshipBriefListQuerySchema = z
  .object({
    /** A founder's own company; absent: the actor's investor organisation. */
    companyId: UuidSchema.optional(),
    /** Comma-separated relationship ids (a page of the list); absent: the first page. */
    ids: z
      .string()
      .max(40 * RELATIONSHIP_BRIEFS_MAX)
      .optional(),
  })
  .strict();
export const RelationshipBriefListSchema = z
  .object({
    items: z.array(RelationshipBriefSchema).max(RELATIONSHIP_BRIEFS_MAX),
  })
  .strict();
export type RelationshipBriefList = z.infer<typeof RelationshipBriefListSchema>;
export type RelationshipBriefMessage = z.infer<
  typeof RelationshipBriefMessageSchema
>;
export type RelationshipBriefMeeting = z.infer<
  typeof RelationshipBriefMeetingSchema
>;
export type RelationshipBriefDecision = z.infer<
  typeof RelationshipBriefDecisionSchema
>;
