import { z, type ZodType } from "zod";

import {
  ContractValidationError,
  RELATIONSHIP_EVENT_PAYLOAD_MAX_BYTES,
  RelationshipEventTypeSchema,
  RelationshipSourceIdSchema,
  UuidSchema,
  type DisclosureScope,
} from "@capital-q/contracts";

import {
  RelationshipEventTypeUnknownError,
  RelationshipEventVisibilityNotAllowedError,
} from "./errors.js";

/**
 * The Network-owned relationship event registry. Every history row's type,
 * payload and visibility scope are validated here before append. Payloads
 * are small typed references; the registry is what keeps the history from
 * becoming a document or message store. Only `discovered` exists in
 * CQ-NET-001; later packets register their own types (interest_expressed,
 * match_created, ...) with their own schemas and allowed scopes.
 */

export type RelationshipEventDefinition<TPayload = unknown> = {
  readonly type: string;
  readonly payloadSchema: ZodType<TPayload>;
  /** Scopes the owning workflow may choose. Discovery is never relationship_shared. */
  readonly allowedVisibilityScopes: readonly DisclosureScope[];
  readonly description: string;
};

export function defineRelationshipEvent<TPayload>(
  definition: RelationshipEventDefinition<TPayload>,
): RelationshipEventDefinition<TPayload> {
  RelationshipEventTypeSchema.parse(definition.type);
  if (definition.allowedVisibilityScopes.length === 0) {
    throw new TypeError(
      `relationship event ${definition.type} allows no visibility scope`,
    );
  }
  return definition;
}

/** The origin of a pair: one party encountered the other. Private to the discovering party. */
export const DiscoveredPayloadSchema = z
  .object({
    sourceReference: RelationshipSourceIdSchema.optional(),
  })
  .strict();
export type DiscoveredPayload = z.infer<typeof DiscoveredPayloadSchema>;

export const RELATIONSHIP_EVENT_DISCOVERED = "discovered" as const;

export const DiscoveredRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DISCOVERED,
  payloadSchema: DiscoveredPayloadSchema,
  allowedVisibilityScopes: [
    "personal_private",
    "organisation_private",
    "founder_private",
    "investor_private",
  ],
  description:
    "The pair entered the network: one party discovered the other. Never shared with the other party by itself.",
});

/**
 * An investor organisation expressed interest in the company (CQ-NET-010).
 *
 * Unilateral, and deliberately addressed to the other party: its purpose is
 * to let the founders know the organisation would like to explore the
 * company (doc 17 §70), so `relationship_shared` is its only scope. It is
 * not a match and records no state; the payload names the interest record
 * and nothing else.
 */
export const InterestExpressedPayloadSchema = z
  .object({
    interestId: UuidSchema,
    // Who reached out (ADR 0023). Absent on every event written before
    // founders could send Connection Requests: those are all INVESTOR.
    expressedByParty: z.enum(["INVESTOR", "COMPANY"]).optional(),
  })
  .strict();
export type InterestExpressedPayload = z.infer<
  typeof InterestExpressedPayloadSchema
>;

export const RELATIONSHIP_EVENT_INTEREST_EXPRESSED =
  "interest_expressed" as const;

export const InterestExpressedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
  payloadSchema: InterestExpressedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "An investor organisation expressed interest in the company. Unilateral: not a match, not a commitment.",
});

/**
 * The company accepted the investor's interest, and the formal bilateral
 * connection -- the match -- opened (CQ-NET-011; doc 17 §85: "both sides
 * have agreed to connect"). Shared, because both sides are its subject.
 */
export const ConnectionAcceptedPayloadSchema = z
  .object({
    interestId: UuidSchema,
    matchId: UuidSchema,
  })
  .strict();
export type ConnectionAcceptedPayload = z.infer<
  typeof ConnectionAcceptedPayloadSchema
>;
export const RELATIONSHIP_EVENT_CONNECTION_ACCEPTED =
  "connection_accepted" as const;
export const ConnectionAcceptedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  payloadSchema: ConnectionAcceptedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The company accepted the investor organisation's interest; both sides have agreed to connect. Not an investment.",
});

/**
 * The company declined the investor's interest (CQ-NET-011). Shared and
 * honest -- the investor is not left waiting on something already decided
 * -- and carries no reason: nothing harsh, nothing private.
 */
export const InterestDeclinedPayloadSchema = z
  .object({
    interestId: UuidSchema,
  })
  .strict();
export type InterestDeclinedPayload = z.infer<
  typeof InterestDeclinedPayloadSchema
>;
export const RELATIONSHIP_EVENT_INTEREST_DECLINED =
  "interest_declined" as const;
export const InterestDeclinedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_INTEREST_DECLINED,
  payloadSchema: InterestDeclinedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The company has not taken the investor organisation's interest forward. No reason is recorded.",
});

/**
 * Mail on the relationship (BIZ-007). A person's approved email to the
 * counterpart went out from their own connected mailbox, and a reply to it
 * arrived. Both are activity, not state: the projector does not move on
 * them. The payload names the integrations mail record and nothing else --
 * never a subject, a body or an address.
 */
export const EmailActivityPayloadSchema = z
  .object({
    emailMessageId: UuidSchema,
  })
  .strict();
export type EmailActivityPayload = z.infer<typeof EmailActivityPayloadSchema>;

export const RELATIONSHIP_EVENT_OUTREACH_SENT = "outreach_sent" as const;
export const OutreachSentRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_OUTREACH_SENT,
  payloadSchema: EmailActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A person on one side emailed the other side from their connected mailbox, after approving the exact message.",
});

export const RELATIONSHIP_EVENT_REPLY_RECEIVED = "reply_received" as const;
export const ReplyReceivedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_REPLY_RECEIVED,
  payloadSchema: EmailActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The other side replied to an email sent on this relationship. Matched by the thread of the message Capital Q sent.",
});

/**
 * A chat message on the relationship thread (R34). Activity, never a state
 * move: talking is not interest, a match or an outcome. The payload names
 * the communication message and nothing else -- never its words.
 */
export const ChatActivityPayloadSchema = z
  .object({
    messageId: UuidSchema,
  })
  .strict();
export type ChatActivityPayload = z.infer<typeof ChatActivityPayloadSchema>;

export const RELATIONSHIP_EVENT_MESSAGE_SENT = "message_sent" as const;
export const MessageSentRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MESSAGE_SENT,
  payloadSchema: ChatActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A person on one side sent a message on the relationship's chat thread.",
});

/**
 * A call on the relationship (BIZ-008). The organiser approved the exact
 * invite; the event names the communication meeting and nothing else --
 * never its purpose, times or attendees. Activity only: a meeting is not
 * interest, a match or an outcome.
 */
export const MeetingActivityPayloadSchema = z
  .object({
    meetingId: UuidSchema,
  })
  .strict();
export type MeetingActivityPayload = z.infer<
  typeof MeetingActivityPayloadSchema
>;

export const RELATIONSHIP_EVENT_MEETING_SCHEDULED =
  "meeting_scheduled" as const;
export const MeetingScheduledRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MEETING_SCHEDULED,
  payloadSchema: MeetingActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A person on one side invited the other side to a call, after approving the exact invite.",
});

export const RELATIONSHIP_EVENT_MEETING_RESCHEDULED =
  "meeting_rescheduled" as const;
export const MeetingRescheduledRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MEETING_RESCHEDULED,
  payloadSchema: MeetingActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "The organiser moved a call to a new time, after approving it.",
});

export const RELATIONSHIP_EVENT_MEETING_CANCELLED =
  "meeting_cancelled" as const;
export const MeetingCancelledRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MEETING_CANCELLED,
  payloadSchema: MeetingActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "The organiser cancelled a call, after approving it.",
});

/**
 * The call happened and Q kept its record (ADR 0027): the relationship's
 * history marks it, which is also the trail of what Capital Q arranged.
 * Activity only: a meeting held is not interest, a commitment or an outcome.
 */
export const RELATIONSHIP_EVENT_MEETING_HELD = "meeting_held" as const;
export const MeetingHeldRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MEETING_HELD,
  payloadSchema: MeetingActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A call booked on Capital Q took place and Q recorded it for both sides.",
});

/**
 * Commitments (spec 6.6.14): money one side stated, confirmed by the
 * other, or withdrawn. Activity only: a commitment is an outcome signal,
 * never a relationship state; the amount lives on the commitment row, not
 * in the event.
 */
export const CommitmentActivityPayloadSchema = z
  .object({
    commitmentId: UuidSchema,
    // The level confirmed (relationship-state.v2 reads INVESTED from it).
    // Absent on every event written before 2026-10-02.
    level: z.enum(["SOFT", "FIRM", "INVESTED"]).optional(),
  })
  .strict();
export type CommitmentActivityPayload = z.infer<
  typeof CommitmentActivityPayloadSchema
>;

export const RELATIONSHIP_EVENT_COMMITMENT_STATED =
  "commitment_stated" as const;
export const CommitmentStatedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_STATED,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "One side stated a commitment (soft, firm or invested) for the other side to confirm.",
});

export const RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED =
  "commitment_confirmed" as const;
export const CommitmentConfirmedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "The other side confirmed a stated commitment.",
});

export const RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN =
  "commitment_withdrawn" as const;
export const CommitmentWithdrawnRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "A party withdrew the relationship's current commitment.",
});

/** A participant declined recording of a Capital Q call (founder direction 2026-09-30). */
export const RELATIONSHIP_EVENT_MEETING_RECORDING_DECLINED =
  "meeting_recording_declined" as const;
export const MeetingRecordingDeclinedRelationshipEvent =
  defineRelationshipEvent({
    type: RELATIONSHIP_EVENT_MEETING_RECORDING_DECLINED,
    payloadSchema: MeetingActivityPayloadSchema,
    allowedVisibilityScopes: ["relationship_shared"],
    description:
      "A participant declined Q's recording of a call booked on Capital Q; the call still counts as held through Capital Q.",
  });

/**
 * A call booked on Capital Q where an expected side never came (MEET-HOST,
 * founder direction 2026-10-01): Q waited out its grace period and left.
 * Activity only: a missed call is not a relationship state or an outcome.
 */
export const RELATIONSHIP_EVENT_MEETING_NO_SHOW = "meeting_no_show" as const;
export const MeetingNoShowRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_MEETING_NO_SHOW,
  payloadSchema: MeetingActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A call booked on Capital Q did not take place because nobody, or only one side, came.",
});

/** Q heard money in a call and filed it for both sides to adopt or dispute. */
export const RELATIONSHIP_EVENT_COMMITMENT_DETECTED =
  "commitment_detected" as const;
export const CommitmentDetectedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "Q heard money in a call it recorded and filed it as a detected commitment; it counts only once adopted and confirmed.",
});

export const RELATIONSHIP_EVENT_COMMITMENT_DISPUTED =
  "commitment_disputed" as const;
export const CommitmentDisputedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "A party disputed money Q detected in a call.",
});

/**
 * The money's last two steps (2026-10-04): the investor's side marked a
 * confirmed commitment sent, then the company's side confirmed it arrived.
 * relationship-state.v2 moves to INVESTED on receipt; marking it sent is
 * activity. The amount and any reference stay on the commitment row.
 */
export const RELATIONSHIP_EVENT_COMMITMENT_TRANSFER_SENT =
  "commitment_transfer_sent" as const;
export const CommitmentTransferSentRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_TRANSFER_SENT,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The investor's side marked a confirmed commitment as sent; it counts as raised only once the company's side confirms receipt.",
});

export const RELATIONSHIP_EVENT_COMMITMENT_RECEIVED =
  "commitment_received" as const;
export const CommitmentReceivedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
  payloadSchema: CommitmentActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The company's side confirmed a commitment's money arrived: invested capital.",
});

export type RelationshipEventRegistry = {
  readonly get: (eventType: string) => RelationshipEventDefinition | undefined;
  readonly types: () => readonly string[];
  /** Throws when the type is unknown, the scope is not allowed, or the payload is invalid or too large. */
  readonly validate: (input: {
    readonly eventType: string;
    readonly visibilityScope: DisclosureScope;
    readonly payload: unknown;
  }) => Readonly<Record<string, unknown>>;
};

export function createRelationshipEventRegistry(
  definitions: readonly RelationshipEventDefinition[],
): RelationshipEventRegistry {
  const byType = new Map<string, RelationshipEventDefinition>();
  for (const definition of definitions) {
    if (byType.has(definition.type)) {
      throw new TypeError(
        `relationship event ${definition.type} is registered twice`,
      );
    }
    byType.set(definition.type, definition);
  }
  return {
    get: (eventType) => byType.get(eventType),
    types: () => [...byType.keys()],
    validate: ({ eventType, visibilityScope, payload }) => {
      const definition = byType.get(eventType);
      if (definition === undefined) {
        throw new RelationshipEventTypeUnknownError(eventType);
      }
      if (!definition.allowedVisibilityScopes.includes(visibilityScope)) {
        throw new RelationshipEventVisibilityNotAllowedError(
          eventType,
          visibilityScope,
        );
      }
      const parsed = definition.payloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ContractValidationError(
          "The relationship event payload is not valid.",
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            code: issue.code,
            message: issue.message,
          })),
        );
      }
      const object = parsed.data as Readonly<Record<string, unknown>>;
      if (
        Buffer.byteLength(JSON.stringify(object), "utf8") >
        RELATIONSHIP_EVENT_PAYLOAD_MAX_BYTES
      ) {
        throw new ContractValidationError(
          "The relationship event payload exceeds its bound.",
          [{ path: "payload", code: "too_big", message: "payload too large" }],
        );
      }
      return object;
    },
  };
}

/**
 * Post-meeting outcomes (founder request 2026-10-02; Product Specification
 * 6.6.10-6.6.14; doc 13 §28). Each is shared, because both sides are its
 * subject and the founder is owed an honest answer; none carries a reason
 * or a note. A pass's reason lives in network.relationship_passes, private
 * to the investor unless they chose to share it (founder decision (a)).
 */
const OutcomeSideSchema = z.enum(["INVESTOR", "COMPANY"]);

export const RelationshipPassedPayloadSchema = z
  .object({
    passId: UuidSchema,
    side: OutcomeSideSchema,
    /** Whether the reason was shared with the founder; never the reason. */
    reasonShared: z.boolean(),
  })
  .strict();
export const RELATIONSHIP_EVENT_RELATIONSHIP_PASSED =
  "relationship_passed" as const;
export const RelationshipPassedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  payloadSchema: RelationshipPassedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The investor organisation decided not to proceed for now. Carries no reason: a shared reason is read from the pass record.",
});

export const OutcomeActivityPayloadSchema = z
  .object({
    side: OutcomeSideSchema,
    meetingId: UuidSchema.optional(),
  })
  .strict();

export const RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED =
  "relationship_paused" as const;
export const RelationshipPausedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED,
  payloadSchema: OutcomeActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "One side paused the relationship for now. Not a pass, not a decline.",
});

export const RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED =
  "relationship_resumed" as const;
export const RelationshipResumedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
  payloadSchema: OutcomeActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A pause was lifted, or the investor reset their pass: the relationship is back where it was.",
});

export const RELATIONSHIP_EVENT_DILIGENCE_STARTED =
  "diligence_started" as const;
export const DiligenceStartedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  payloadSchema: OutcomeActivityPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "Both sides are in diligence. Not a commitment and not an investment.",
});

export const RelationshipProgressedPayloadSchema = z
  .object({
    side: OutcomeSideSchema,
    /** What was agreed next, as a bounded code (e.g. FOLLOW_UP_MEETING). */
    step: z.string().regex(/^[A-Z][A-Z_]{1,31}$/),
    meetingId: UuidSchema.optional(),
  })
  .strict();
export const RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED =
  "relationship_progressed" as const;
export const RelationshipProgressedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED,
  payloadSchema: RelationshipProgressedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "A meeting's outcome was confirmed as moving forward (another meeting, materials). Recorded, not a state of its own.",
});

/**
 * Diligence (2026-10-02): the investor asked for a document, or the founder
 * shared one with this relationship. Activity only, shared by both sides;
 * the request's words live on its row and the share is a disclosure policy.
 */
export const DocumentRequestedPayloadSchema = z
  .object({ requestId: UuidSchema })
  .strict();
export const RELATIONSHIP_EVENT_DOCUMENT_REQUESTED =
  "document_requested" as const;
export const DocumentRequestedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
  payloadSchema: DocumentRequestedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "The investor asked for a document in diligence.",
});

export const DocumentSharedPayloadSchema = z
  .object({
    documentId: UuidSchema,
    disclosurePolicyId: UuidSchema,
    /** The request it answered, when it answered one. */
    requestId: UuidSchema.optional(),
  })
  .strict();
export const RELATIONSHIP_EVENT_DOCUMENT_SHARED = "document_shared" as const;
export const DocumentSharedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  payloadSchema: DocumentSharedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The company shared one of its documents with this relationship. Revocable; revoking is the disclosure policy's own history.",
});

/**
 * Data room (overnight A3, 2026-10-06): the investor asked for an
 * on-request document (or all of them), and the founder granted access
 * until a date. Activity only, both sides read it; the grant itself is the
 * disclosure policy, revocable and expiring on its own.
 */
export const DataRoomAccessRequestedPayloadSchema = z
  .object({
    requestId: UuidSchema,
    /** Absent: every on-request document. */
    documentId: UuidSchema.optional(),
  })
  .strict();
export const RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED =
  "data_room_access_requested" as const;
export const DataRoomAccessRequestedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
  payloadSchema: DataRoomAccessRequestedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description: "The investor asked for access to a data-room document.",
});

export const DataRoomAccessGrantedPayloadSchema = z
  .object({
    requestId: UuidSchema,
    documentIds: z.array(UuidSchema).min(1).max(200),
    disclosurePolicyIds: z.array(UuidSchema).min(1).max(200),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED =
  "data_room_access_granted" as const;
export const DataRoomAccessGrantedRelationshipEvent = defineRelationshipEvent({
  type: RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  payloadSchema: DataRoomAccessGrantedPayloadSchema,
  allowedVisibilityScopes: ["relationship_shared"],
  description:
    "The company granted this relationship access to data-room documents until a date. Revocable; the disclosure policy holds the grant.",
});

/**
 * Production registry: `discovered` (CQ-NET-001), `interest_expressed`
 * (CQ-NET-010), `connection_accepted` and `interest_declined` (CQ-NET-011).
 */
export const RELATIONSHIP_EVENT_DEFINITIONS: readonly RelationshipEventDefinition[] =
  [
    DiscoveredRelationshipEvent,
    InterestExpressedRelationshipEvent,
    ConnectionAcceptedRelationshipEvent,
    InterestDeclinedRelationshipEvent,
    OutreachSentRelationshipEvent,
    ReplyReceivedRelationshipEvent,
    MessageSentRelationshipEvent,
    MeetingScheduledRelationshipEvent,
    MeetingRescheduledRelationshipEvent,
    MeetingCancelledRelationshipEvent,
    MeetingHeldRelationshipEvent,
    CommitmentStatedRelationshipEvent,
    CommitmentConfirmedRelationshipEvent,
    CommitmentWithdrawnRelationshipEvent,
    MeetingRecordingDeclinedRelationshipEvent,
    CommitmentDetectedRelationshipEvent,
    CommitmentDisputedRelationshipEvent,
    CommitmentTransferSentRelationshipEvent,
    CommitmentReceivedRelationshipEvent,
    MeetingNoShowRelationshipEvent,
    RelationshipPassedRelationshipEvent,
    RelationshipPausedRelationshipEvent,
    RelationshipResumedRelationshipEvent,
    DiligenceStartedRelationshipEvent,
    RelationshipProgressedRelationshipEvent,
    DocumentRequestedRelationshipEvent,
    DocumentSharedRelationshipEvent,
    DataRoomAccessRequestedRelationshipEvent,
    DataRoomAccessGrantedRelationshipEvent,
  ];
