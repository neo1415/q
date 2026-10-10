import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { QAttentionSourceSchema } from "./attention.js";

/**
 * The Arrival Snapshot (W1, founder 2026-10-10: "Q already knows what it
 * just told me").
 *
 * The welcome said "You have a request from TensorGate"; asked "what's the
 * request?" Q fetched again, delegated, or answered wrongly, because the
 * welcome knew things Q's Brain did not. This is the ONE canonical,
 * versioned read of what the person was just told, built server-side for
 * the asking actor only. The welcome, Q's turns, the live voice session
 * and the Work list all read this same object, so a headline and its
 * answer can never disagree.
 *
 * Rules the shape enforces:
 *  - every headline carries the facts it was read from, or says
 *    UNAVAILABLE (honest unknown, never an empty history);
 *  - only bounded, authorised detail: the latest message previews of the
 *    person's own thread, never a whole thread;
 *  - data, never instructions: nothing in it authorises an action.
 */

export const Q_ARRIVAL_SNAPSHOT_PATH = "/v1/q/arrival-snapshot" as const;
export const ARRIVAL_SNAPSHOT_VERSION = "arrival-snapshot.v1" as const;
export const ARRIVAL_SNAPSHOT_ITEMS_MAX = 30;
export const ARRIVAL_MESSAGE_PREVIEW_MAX = 240;

const Timestamp = z.string().datetime({ offset: true });

export const ArrivalSnapshotMessageSchema = z
  .object({
    from: z.enum(["YOU", "YOUR_SIDE", "OTHER_SIDE"]),
    senderName: z.string().max(200),
    /** Bounded preview of the message as it stands now; null: not read. */
    text: z.string().max(ARRIVAL_MESSAGE_PREVIEW_MAX).nullable(),
    kind: z.enum(["TEXT", "ATTACHMENT", "VOICE_NOTE"]),
    /** Stored on the thread and visible to both sides; no read receipts. */
    status: z.literal("SENT"),
    viaQ: z.boolean(),
    sentAt: Timestamp,
  })
  .strict();
export type ArrivalSnapshotMessage = z.infer<
  typeof ArrivalSnapshotMessageSchema
>;

export const ArrivalSnapshotMeetingSchema = z
  .object({
    id: UuidSchema,
    status: z.enum(["SCHEDULING", "SCHEDULED", "CANCELLED", "FAILED"]),
    startsAt: Timestamp,
    endsAt: Timestamp,
    timing: z.enum(["UPCOMING", "PAST"]),
    organisedByYou: z.boolean(),
    /**
     * The call is booked on both calendars (status SCHEDULED). Capital Q
     * does not track a separate accept click, so "they accepted the time"
     * is exactly this and no stronger.
     */
    booked: z.boolean(),
  })
  .strict();
export type ArrivalSnapshotMeeting = z.infer<
  typeof ArrivalSnapshotMeetingSchema
>;

export const ArrivalSnapshotDecisionSchema = z
  .object({
    kind: z.string().min(1).max(40),
    owner: z.enum(["YOU", "THEM"]),
    since: Timestamp.nullable(),
    /** Plain words for the decision. */
    label: z.string().max(160),
  })
  .strict();

export const ARRIVAL_REQUEST_KINDS = [
  /** The other side wants to connect / expressed interest. */
  "CONNECTION_OR_INTEREST",
  /** Diligence / data-room items asked for. */
  "DOCUMENTS",
  /** A message waiting for a reply. */
  "REPLY",
  /** A change waiting for the person's approval. */
  "APPROVAL",
  /** A call to confirm or schedule. */
  "MEETING",
  "OTHER",
] as const;

export const ArrivalSnapshotFactsSchema = z
  .object({
    /** The triggering request, in plain words, with who made it and when. */
    request: z
      .object({
        kind: z.enum(ARRIVAL_REQUEST_KINDS),
        from: z.string().max(200).nullable(),
        since: Timestamp.nullable(),
        summary: z.string().max(400),
      })
      .strict()
      .nullable(),
    messageCount: z.number().int().min(0).nullable(),
    /** The newest message on the thread. */
    latestMessage: ArrivalSnapshotMessageSchema.nullable(),
    /** The other side's newest message (may be the same one). */
    theirLatestMessage: ArrivalSnapshotMessageSchema.nullable(),
    meeting: ArrivalSnapshotMeetingSchema.nullable(),
    decisions: z.array(ArrivalSnapshotDecisionSchema).max(10),
    documents: z
      .array(z.object({ id: UuidSchema, title: z.string().max(300) }).strict())
      .max(10),
    openRequests: z
      .array(z.object({ id: UuidSchema, title: z.string().max(200) }).strict())
      .max(10),
    /** Relationship state in the Network projector's words, when known. */
    relationshipState: z.string().max(40).nullable(),
    suggestedNextAction: z
      .object({
        kind: z.string().min(1).max(40),
        owner: z.enum(["YOU", "THEM"]),
        label: z.string().max(160),
      })
      .strict()
      .nullable(),
    /** The source's own note (notices, matches, approvals). */
    note: z.string().max(600).nullable(),
  })
  .strict();
export type ArrivalSnapshotFacts = z.infer<typeof ArrivalSnapshotFactsSchema>;

export const ArrivalSnapshotItemSchema = z
  .object({
    key: z.string().min(1).max(160),
    /** The attention source this headline came from. */
    kind: QAttentionSourceSchema,
    headline: z.string().min(1).max(200),
    /**
     * OK: facts were read. UNAVAILABLE: the headline stands but its detail
     * could not be read now; Q must say it could not check, not guess.
     */
    availability: z.enum(["OK", "UNAVAILABLE"]),
    counterpart: z
      .object({
        kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
        id: UuidSchema,
        name: z.string().max(200).nullable(),
      })
      .strict()
      .nullable(),
    ids: z
      .object({
        relationshipId: UuidSchema.nullable(),
        companyId: UuidSchema.nullable(),
        investorOrganisationId: UuidSchema.nullable(),
        meetingId: UuidSchema.nullable(),
        approvalId: UuidSchema.nullable(),
        jobId: UuidSchema.nullable(),
        documentId: UuidSchema.nullable(),
        messageId: UuidSchema.nullable(),
      })
      .strict(),
    facts: ArrivalSnapshotFactsSchema,
    /** Where "open the conversation" goes (in-app path); null: nowhere to open. */
    openPath: z.string().max(300).nullable(),
    decidable: z.boolean(),
    /** What each fact was read from, so an answer can cite it. */
    evidence: z
      .array(
        z
          .object({
            source: z.enum([
              "ATTENTION",
              "RELATIONSHIP_BRIEF",
              "RELATIONSHIP_HISTORY",
              "THREAD",
              "SCHEDULE",
              "DILIGENCE",
            ]),
            ref: z.string().max(80).nullable(),
            asOf: Timestamp,
          })
          .strict(),
      )
      .max(8),
    sourceVersions: z
      .object({
        historySequence: z.number().int().min(0).nullable(),
        brief: z.string().max(40).nullable(),
      })
      .strict(),
    since: Timestamp,
    asOf: Timestamp,
  })
  .strict();
export type ArrivalSnapshotItem = z.infer<typeof ArrivalSnapshotItemSchema>;

export const ArrivalSnapshotSchema = z
  .object({
    contractVersion: z.literal(ARRIVAL_SNAPSHOT_VERSION),
    /**
     * Changes whenever any fact in the snapshot does (a hash of the items'
     * sources), so a consumer can tell "same as I was told" from "new".
     */
    version: z.string().min(1).max(80),
    asOf: Timestamp,
    items: z.array(ArrivalSnapshotItemSchema).max(ARRIVAL_SNAPSHOT_ITEMS_MAX),
    /** Attention sources that could not be read; never reported as empty. */
    unread: z.array(QAttentionSourceSchema),
    /** Whether the relationship briefs behind the items were readable. */
    briefsRead: z.boolean(),
  })
  .strict();
export type ArrivalSnapshot = z.infer<typeof ArrivalSnapshotSchema>;

/**
 * The in-app route of a relationship's conversation, from the counterpart
 * (the same mapping as the web `recordPagePath`): an investor's side opens
 * the company's page, a founder's side the investor's.
 */
export function relationshipMessagesPath(
  counterpartKind: "COMPANY" | "INVESTOR_ORGANISATION",
  counterpartId: string,
): string {
  const safe = encodeURIComponent(counterpartId.toLowerCase());
  return counterpartKind === "COMPANY"
    ? `/relationships/company/${safe}/messages`
    : `/relationships/investor/${safe}/messages`;
}
