import { z } from "zod";

import { CorrelationIdSchema, UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { MarketplaceVisibilitySchema } from "./companies.js";

/**
 * Relationship contracts (CQ-NET-001).
 *
 * There is deliberately no generic relationship read route: the only HTTP
 * surface is the investor's own Express Interest command and status
 * (CQ-NET-010, below). These are the safe vocabularies and DTO shapes later
 * routes and consumers will use. A relationship existing is not a disclosure permission, and no
 * DTO here carries an event payload.
 *
 *   Relationship ≠ Recommendation ≠ Impression ≠ Save ≠ Interest ≠ Match ≠ Deal
 */

/**
 * Derived projection vocabulary, relationship-state.v1 (CQ-NET-012): the
 * deterministic projector folds the history into one of these. Stored as
 * bounded text, so a later projector version can extend it without an
 * enum migration.
 *
 *   DISCOVERED -> INTEREST_EXPRESSED -> CONNECTED
 *                                    -> DECLINED -> INTEREST_EXPRESSED
 */
export const RELATIONSHIP_CURRENT_STATES = [
  "DISCOVERED",
  "INTEREST_EXPRESSED",
  "CONNECTED",
  "DECLINED",
] as const;
export const RelationshipStateV1Schema = z.enum(RELATIONSHIP_CURRENT_STATES);
export type RelationshipStateV1 = z.infer<typeof RelationshipStateV1Schema>;

/**
 * relationship-state.v2 (founder request 2026-10-02: the journey no longer
 * stops at "meeting held"). Append-only: every v1 state keeps its meaning
 * and v1 projections stay readable; v2 adds what happens after a meeting.
 *
 *   CONNECTED --meeting_held--> MEETING_HELD
 *   CONNECTED | MEETING_HELD --diligence_started--> IN_DILIGENCE
 *   any match state --relationship_paused--> PAUSED --relationship_resumed--> back
 *   any match state --relationship_passed--> PASSED --relationship_resumed--> back
 *   any match state --commitment_confirmed (INVESTED)--> INVESTED
 */
export const RELATIONSHIP_STATES_V2 = [
  ...RELATIONSHIP_CURRENT_STATES,
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
  "PASSED",
  "INVESTED",
] as const;
export const RelationshipStateV2Schema = z.enum(RELATIONSHIP_STATES_V2);
export type RelationshipStateV2 = z.infer<typeof RelationshipStateV2Schema>;

/**
 * The states in which the match (CONNECTED, doc 17 §85) is open: both sides
 * agreed to connect, so the thread, meetings and commitments belong to it.
 * A pass or a pause does not unmake the match; it changes what is next.
 */
export const RELATIONSHIP_MATCHED_STATES: readonly RelationshipStateV2[] = [
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
  "PASSED",
  "INVESTED",
];
export function isMatchedRelationshipState(state: string): boolean {
  return (RELATIONSHIP_MATCHED_STATES as readonly string[]).includes(state);
}

/**
 * The match is open AND moving: the active pipeline (6.6.15) and the states
 * in which a meeting, diligence or a commitment can still be taken forward.
 * Not PAUSED, PASSED or INVESTED.
 */
export const RELATIONSHIP_ACTIVE_MATCH_STATES: readonly RelationshipStateV2[] =
  ["CONNECTED", "MEETING_HELD", "IN_DILIGENCE"];
export function isActiveMatchState(state: string): boolean {
  return (RELATIONSHIP_ACTIVE_MATCH_STATES as readonly string[]).includes(
    state,
  );
}

/**
 * Why an investor passed after engagement (Product Specification 6.6.10).
 * The codes are reference data (network.relationship_pass_reasons); this is
 * only the shape a code must have. The database decides which exist.
 */
export const RelationshipPassReasonCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z_]{1,31}$/);

export const RelationshipCurrentStateSchema = z
  .string()
  .regex(/^[A-Z][A-Z_]{0,31}$/);
export const RELATIONSHIP_STATE_DISCOVERED = "DISCOVERED" as const;

/** Where a relationship or event originated. Provenance only, never identity. */
export const RELATIONSHIP_SOURCE_TYPES = [
  "DISCOVER",
  "GATEQ",
  "SEARCH",
  "RECOMMENDATION",
  "Q",
  "MANUAL",
  "SYSTEM",
] as const;
export const RelationshipSourceTypeSchema = z.enum(RELATIONSHIP_SOURCE_TYPES);
export type RelationshipSourceType = z.infer<
  typeof RelationshipSourceTypeSchema
>;

/** Opaque bounded origin reference (a slate item, a GateQ application …). Never a body or a prompt. */
export const RelationshipSourceIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^[\x21-\x7e\u00a0-\uffff]+$/,
    "expected a printable opaque reference",
  );

/**
 * ADR-001 disclosure vocabulary, reused as the visibility scope of every
 * relationship event. `public`, `shared` and `private` are not values.
 */
export const DisclosureScopeSchema = MarketplaceVisibilitySchema;
export type DisclosureScope = z.infer<typeof DisclosureScopeSchema>;

/** Bounded, versionable relationship event type name. Registered per type by the Network domain. */
export const RelationshipEventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case event type")
  .max(64);

export const RELATIONSHIP_EVENT_PAYLOAD_MAX_BYTES = 8192;

/** Relationship summary. The tenant anchor is internal and deliberately absent. */
export const RelationshipDtoSchema = z.object({
  id: UuidSchema,
  companyId: UuidSchema,
  investorOrganisationId: UuidSchema,
  currentState: RelationshipCurrentStateSchema,
  firstDiscoveredAt: UtcTimestampSchema,
  stateUpdatedAt: UtcTimestampSchema,
  lastEventSequence: z.number().int().min(0),
});
export type RelationshipDto = z.infer<typeof RelationshipDtoSchema>;

/**
 * Event summary without payload. Payload exposure is decided per event type
 * and per party by later disclosure rules; there is no universal event DTO
 * carrying payloads.
 */
export const RelationshipEventSummaryDtoSchema = z.object({
  id: UuidSchema,
  sequence: z.number().int().min(1),
  eventType: RelationshipEventTypeSchema,
  occurredAt: UtcTimestampSchema,
  actorType: z.enum(["HUMAN", "Q", "SYSTEM", "CONNECTED_SYSTEM"]),
  actorId: UuidSchema,
  sourceType: RelationshipSourceTypeSchema,
  sourceId: RelationshipSourceIdSchema.nullable(),
  visibilityScope: DisclosureScopeSchema,
  correlationId: CorrelationIdSchema,
});
export type RelationshipEventSummaryDto = z.infer<
  typeof RelationshipEventSummaryDtoSchema
>;

// ---------------------------------------------------------------------------
// Express Interest (CQ-NET-010; doc 13 §29.1, doc 17 §70, doc 22 §42-§45)
// ---------------------------------------------------------------------------

/**
 * `POST /v1/network/companies/:companyId/express-interest`.
 *
 * Keyed by company rather than by relationship: an investor expressing
 * interest from the feed may be the reason the canonical relationship comes
 * to exist, and a client never needs to know a relationship id to ask.
 * Consequential, so an Idempotency-Key header is required
 * (IDEMPOTENCY_KEY_HEADER); the same key and company return the original
 * result, the same key with another company is IDEMPOTENCY_CONFLICT.
 *
 * Interest ≠ Match: this never creates a match or a connection, and it is
 * not a Save — the feed's Save/Pass stay on `/v1/discovery`.
 */
export const NETWORK_COMPANY_EXPRESS_INTEREST_PATH =
  "/v1/network/companies/:companyId/express-interest" as const;
/** `GET`: the caller's own investor organisation's interest in this company, if any. */
export const NETWORK_COMPANY_INTEREST_PATH =
  "/v1/network/companies/:companyId/interest" as const;

/**
 * Where the person was. Provenance only: it becomes the relationship
 * event's source and never widens who may act. There is no field for an
 * organisation, a tenant or a relationship — those are the server's answers.
 */
export const ExpressInterestRequestSchema = z
  .object({
    surface: z.enum(["RECOMMENDATION_FEED", "COMPANY_PROFILE"]),
  })
  .strict();
export type ExpressInterestRequest = z.infer<
  typeof ExpressInterestRequestSchema
>;

/**
 * The company's answer to an interest (CQ-NET-011). PENDING until the
 * company answers; there is no reason field, by design — a decline is
 * recorded honestly and carries nothing harsh or private.
 */
export const INTEREST_RESPONSES = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export const InterestResponseStatusSchema = z.enum(INTEREST_RESPONSES);
export type InterestResponseStatus = z.infer<
  typeof InterestResponseStatusSchema
>;

/**
 * The formal bilateral connection (doc 13's `network.matches` row) opened
 * by an acceptance: both sides have agreed to connect. Not an investment.
 */
export const ConnectionDtoSchema = z
  .object({
    connectionId: UuidSchema,
    status: z.enum(["ACTIVE", "ENDED"]),
    connectedAt: UtcTimestampSchema,
  })
  .strict();
export type ConnectionDto = z.infer<typeof ConnectionDtoSchema>;

/**
 * Unilateral. `response` and `connection` (CQ-NET-011) say how the company
 * answered; they default so a NET-010 reader keeps parsing.
 */
export const InterestDtoSchema = z
  .object({
    interestId: UuidSchema,
    relationshipId: UuidSchema,
    companyId: UuidSchema,
    status: z.enum(["EXPRESSED", "WITHDRAWN"]),
    expressedAt: UtcTimestampSchema,
    response: InterestResponseStatusSchema.default("PENDING"),
    respondedAt: UtcTimestampSchema.nullable().default(null),
    connection: ConnectionDtoSchema.nullable().default(null),
  })
  .strict();
export type InterestDto = z.infer<typeof InterestDtoSchema>;

/** `deduplicated` is true when the interest already existed: nothing new was written. */
export const ExpressInterestResultDtoSchema = z
  .object({
    interest: InterestDtoSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type ExpressInterestResultDto = z.infer<
  typeof ExpressInterestResultDtoSchema
>;

export const CompanyInterestStatusDtoSchema = z
  .object({ interest: InterestDtoSchema.nullable() })
  .strict();
export type CompanyInterestStatusDto = z.infer<
  typeof CompanyInterestStatusDtoSchema
>;

// ---------------------------------------------------------------------------
// Where are we (CQ-NET-012; doc 25 §120-§121, doc 17 §83, §197)
// ---------------------------------------------------------------------------

/**
 * `GET /v1/network/companies/:companyId/relationship` — an investor asks
 * about a company; `GET /v1/network/investors/:investorOrganisationId/
 * relationship` — a company asks about an investor organisation.
 *
 * Each party's answer is folded only from the history that party may see:
 * an investor's private discovery never becomes a relationship the company
 * can see ("Apex viewed your company"). `null` means nothing this party
 * may see exists — never "no relationship", which would be a disclosure.
 */
export const NETWORK_COMPANY_RELATIONSHIP_PATH =
  "/v1/network/companies/:companyId/relationship" as const;
export const NETWORK_INVESTOR_RELATIONSHIP_PATH =
  "/v1/network/investors/:investorOrganisationId/relationship" as const;

/** What happened, in order: one entry per state the relationship reached. */
export const RelationshipMilestoneDtoSchema = z
  .object({
    state: RelationshipStateV2Schema,
    at: UtcTimestampSchema,
  })
  .strict();

/**
 * What is next, for the party asking — a plain step, never a score. There
 * is no MEETING state yet (CQ-MTG-001); SCHEDULE_MEETING is doc 17 §86's
 * post-match primary action, offered as the next step, not recorded.
 */
export const RELATIONSHIP_NEXT_STEPS = [
  "EXPRESS_INTEREST",
  "AWAIT_ANSWER",
  "ANSWER_INTEREST",
  "SCHEDULE_MEETING",
  "NONE",
  // relationship-state.v2: after a meeting the investor decides (diligence,
  // pass, pause) and the founder follows up; a pause is resumed.
  "DECIDE_NEXT_STEP",
  "FOLLOW_UP",
  "RESUME",
] as const;

export const RelationshipStatusDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    companyId: UuidSchema,
    investorOrganisationId: UuidSchema,
    /** Where are we. */
    state: RelationshipStateV2Schema,
    stateSince: UtcTimestampSchema,
    /** What happened. */
    milestones: z.array(RelationshipMilestoneDtoSchema).max(64),
    /** What is next, for this party. */
    nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
    projectorVersion: z.string().min(1).max(64),
  })
  .strict();
export type RelationshipStatusDto = z.infer<typeof RelationshipStatusDtoSchema>;

/**
 * The person's own side's relationships (CQ-WEB-030): a list to open,
 * each row the same per-party fold as the single read, so a list and its
 * detail can never disagree.
 *
 *   `GET /v1/network/relationships` — an investor organisation's own.
 *   `GET /v1/network/companies/:companyId/relationships` — a company's own;
 *   a relationship that is only an investor's private discovery is not in
 *   it, because it is nothing the company can see.
 */
export const NETWORK_INVESTOR_RELATIONSHIPS_PATH =
  "/v1/network/relationships" as const;
export const NETWORK_COMPANY_RELATIONSHIPS_PATH =
  "/v1/network/companies/:companyId/relationships" as const;

export const RelationshipSummaryDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    counterpart: z
      .object({
        kind: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
        id: UuidSchema,
        name: z.string().min(1).max(200),
      })
      .strict(),
    state: RelationshipStateV2Schema,
    stateSince: UtcTimestampSchema,
    nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
  })
  .strict();
export type RelationshipSummaryDto = z.infer<
  typeof RelationshipSummaryDtoSchema
>;

export const RelationshipListDtoSchema = z
  .object({ items: z.array(RelationshipSummaryDtoSchema).max(200) })
  .strict();
export type RelationshipListDto = z.infer<typeof RelationshipListDtoSchema>;

export const RelationshipStatusResponseDtoSchema = z
  .object({ relationship: RelationshipStatusDtoSchema.nullable() })
  .strict();
export type RelationshipStatusResponseDto = z.infer<
  typeof RelationshipStatusResponseDtoSchema
>;

// ---------------------------------------------------------------------------
// Connection Acceptance (CQ-NET-011; doc 13 §29.2, doc 17 §85, doc 25 §119)
// ---------------------------------------------------------------------------

/**
 * `GET /v1/network/companies/:companyId/incoming-interest` — the company's
 * inbox: investor organisations that expressed interest, and how the
 * company answered. Authorised to the company's own members holding
 * `company.interest.view`; anyone else gets not-found.
 */
export const NETWORK_COMPANY_INCOMING_INTEREST_PATH =
  "/v1/network/companies/:companyId/incoming-interest" as const;
/**
 * `POST /v1/network/interests/:interestId/{accept|decline}` — the
 * company's answer. The verb is in the path, so a body cannot change its
 * meaning. Consequential: an Idempotency-Key header is required; the same
 * key and answer return the original result, and an interest already
 * answered the other way is RESOURCE_CONFLICT.
 */
export const NETWORK_INTEREST_ACCEPT_PATH =
  "/v1/network/interests/:interestId/accept" as const;
export const NETWORK_INTEREST_DECLINE_PATH =
  "/v1/network/interests/:interestId/decline" as const;

/** Nothing to say but the verb: no reason, no message (CQ-COMM-001 is deferred). */
export const RespondToInterestRequestSchema = z.object({}).strict();
export type RespondToInterestRequest = z.infer<
  typeof RespondToInterestRequestSchema
>;

/**
 * One incoming interest, as the company sees it. The investor
 * organisation is named because expressing interest is addressed to the
 * company; who at the organisation acted, and anything the investor keeps
 * private, is not here.
 */
export const IncomingInterestDtoSchema = z
  .object({
    interestId: UuidSchema,
    investorOrganisationId: UuidSchema,
    investorName: z.string().min(1).max(200),
    investorType: z.string().min(1).max(64),
    expressedAt: UtcTimestampSchema,
    response: InterestResponseStatusSchema,
    respondedAt: UtcTimestampSchema.nullable(),
    connection: ConnectionDtoSchema.nullable(),
  })
  .strict();
export type IncomingInterestDto = z.infer<typeof IncomingInterestDtoSchema>;

export const IncomingInterestListDtoSchema = z
  .object({ items: z.array(IncomingInterestDtoSchema).max(200) })
  .strict();
export type IncomingInterestListDto = z.infer<
  typeof IncomingInterestListDtoSchema
>;

/** `deduplicated` is true when this answer had already been recorded. */
export const InterestResponseResultDtoSchema = z
  .object({
    interest: IncomingInterestDtoSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type InterestResponseResultDto = z.infer<
  typeof InterestResponseResultDtoSchema
>;

// ---------------------------------------------------------------------------
// Founder Connection Requests (ADR 0023; PADL #98, GateQ items 11-13).
// ---------------------------------------------------------------------------

/**
 * `POST /v1/network/investors/:investorOrganisationId/connection-request` —
 * a founder asks, for their company, to connect with an investor who takes
 * requests (OPEN, or QUALIFIED and the company passes the investor's own
 * declared rules). Consequential: an Idempotency-Key header is required.
 * An investor the founder may not see is the same 404 as one that does
 * not exist; one who does not take this request is RESOURCE_CONFLICT with
 * a plain reason.
 *
 * `GET …/connection` — where this founder stands with that investor.
 */
export const NETWORK_INVESTOR_CONNECTION_REQUEST_PATH =
  "/v1/network/investors/:investorOrganisationId/connection-request" as const;
export const NETWORK_INVESTOR_CONNECTION_PATH =
  "/v1/network/investors/:investorOrganisationId/connection" as const;

/** Nothing but the verb: the request carries no message (messaging opens on connection). */
export const ConnectionRequestRequestSchema = z.object({}).strict();

/** Why an investor does not take this founder's request; each is the investor's own choice. */
export const CONNECTION_NOT_ACCEPTED_REASONS = [
  "CLOSED",
  "NOT_STATED",
  "NOT_QUALIFIED",
] as const;

/** A founder's own request, as they see it. */
export const ConnectionRequestDtoSchema = z
  .object({
    interestId: UuidSchema,
    relationshipId: UuidSchema,
    investorOrganisationId: UuidSchema,
    requestedAt: UtcTimestampSchema,
    response: InterestResponseStatusSchema,
    respondedAt: UtcTimestampSchema.nullable(),
    connection: ConnectionDtoSchema.nullable(),
  })
  .strict();
export type ConnectionRequestDto = z.infer<typeof ConnectionRequestDtoSchema>;

export const ConnectionRequestResultDtoSchema = z
  .object({ request: ConnectionRequestDtoSchema, deduplicated: z.boolean() })
  .strict();
export type ConnectionRequestResultDto = z.infer<
  typeof ConnectionRequestResultDtoSchema
>;

export const ConnectionStatusDtoSchema = z
  .object({
    canRequest: z.boolean(),
    notAccepted: z.enum(CONNECTION_NOT_ACCEPTED_REASONS).nullable(),
    request: ConnectionRequestDtoSchema.nullable(),
  })
  .strict();
export type ConnectionStatusDto = z.infer<typeof ConnectionStatusDtoSchema>;

/**
 * `GET /v1/network/connection-requests` — the investor organisation's
 * inbox of founders' requests, newest first, each with its answer. Only
 * the company's institutional facts the investor may already see are
 * named; nothing founder-private.
 *
 * `POST /v1/network/connection-requests/:interestId/{accept|decline}` —
 * the investor's answer; Idempotency-Key required, no body.
 */
export const NETWORK_CONNECTION_REQUESTS_PATH =
  "/v1/network/connection-requests" as const;
export const NETWORK_CONNECTION_REQUEST_ACCEPT_PATH =
  "/v1/network/connection-requests/:interestId/accept" as const;
export const NETWORK_CONNECTION_REQUEST_DECLINE_PATH =
  "/v1/network/connection-requests/:interestId/decline" as const;

export const IncomingConnectionRequestDtoSchema = z
  .object({
    interestId: UuidSchema,
    relationshipId: UuidSchema,
    companyId: UuidSchema,
    companyName: z.string().min(1).max(200),
    requestedAt: UtcTimestampSchema,
    response: InterestResponseStatusSchema,
    respondedAt: UtcTimestampSchema.nullable(),
    connection: ConnectionDtoSchema.nullable(),
  })
  .strict();
export type IncomingConnectionRequestDto = z.infer<
  typeof IncomingConnectionRequestDtoSchema
>;

export const IncomingConnectionRequestListDtoSchema = z
  .object({ items: z.array(IncomingConnectionRequestDtoSchema).max(200) })
  .strict();
export type IncomingConnectionRequestListDto = z.infer<
  typeof IncomingConnectionRequestListDtoSchema
>;

export const ConnectionRequestAnswerDtoSchema = z
  .object({
    request: IncomingConnectionRequestDtoSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type ConnectionRequestAnswerDto = z.infer<
  typeof ConnectionRequestAnswerDtoSchema
>;

/**
 * Post-meeting outcomes (founder request 2026-10-02; Product Specification
 * 6.6.10-6.6.14). The investor's Pass, Pause and Resume on a matched
 * relationship, and either side's confirmed meeting outcome, each a verb in
 * its own path (no generic action route). Server-confirmed and idempotent.
 */
export const NETWORK_RELATIONSHIP_PASS_PATH =
  "/v1/network/relationships/:relationshipId/pass" as const;
export const NETWORK_RELATIONSHIP_PAUSE_PATH =
  "/v1/network/relationships/:relationshipId/pause" as const;
export const NETWORK_RELATIONSHIP_RESUME_PATH =
  "/v1/network/relationships/:relationshipId/resume" as const;
export const NETWORK_RELATIONSHIP_MEETING_OUTCOME_PATH =
  "/v1/network/relationships/:relationshipId/meeting-outcome" as const;
/** The reason categories an investor may give (reference data, 6.6.10). */
export const NETWORK_PASS_REASONS_PATH = "/v1/network/pass-reasons" as const;

/**
 * Founder decision (a): the reason is the investor's private note and a
 * learning signal; it reaches the founder only when shareWithFounder.
 */
export const PassRelationshipRequestSchema = z
  .object({
    reasonCode: RelationshipPassReasonCodeSchema.nullable().optional(),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
    shareWithFounder: z.boolean().default(false),
  })
  .strict();
export type PassRelationshipRequest = z.infer<
  typeof PassRelationshipRequestSchema
>;

/** What a meeting led to, as the person confirmed it (PADL #130). */
export const MEETING_OUTCOMES = [
  "DILIGENCE",
  "FOLLOW_UP_MEETING",
  "MATERIALS_REQUESTED",
  "INTRODUCTIONS",
  "OTHER",
] as const;
export const RecordMeetingOutcomeRequestSchema = z
  .object({
    outcome: z.enum(MEETING_OUTCOMES),
    meetingId: UuidSchema.optional(),
  })
  .strict();
export type RecordMeetingOutcomeRequest = z.infer<
  typeof RecordMeetingOutcomeRequestSchema
>;

export const RelationshipOutcomeResultDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    /** True when it was already the case: nothing new was recorded. */
    deduplicated: z.boolean(),
  })
  .strict();
export type RelationshipOutcomeResultDto = z.infer<
  typeof RelationshipOutcomeResultDtoSchema
>;

export const PassReasonListDtoSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            code: RelationshipPassReasonCodeSchema,
            label: z.string().min(1).max(60),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type PassReasonListDto = z.infer<typeof PassReasonListDtoSchema>;

/**
 * `GET /v1/network/relationships/:relationshipId/pass`: the current pass as
 * the asking side may see it. The investor side sees its own reason and
 * note; the company side sees one only when it was shared, and `null`
 * otherwise -- it learns that the investor passed from the state alone.
 */
export const RelationshipPassDtoSchema = z
  .object({
    passedAt: UtcTimestampSchema,
    reasonCode: RelationshipPassReasonCodeSchema.nullable(),
    reasonLabel: z.string().max(60).nullable(),
    note: z.string().max(1000).nullable(),
    sharedWithFounder: z.boolean(),
  })
  .strict();
export const RelationshipPassResponseDtoSchema = z
  .object({ pass: RelationshipPassDtoSchema.nullable() })
  .strict();
export type RelationshipPassResponseDto = z.infer<
  typeof RelationshipPassResponseDtoSchema
>;

/** One relationship's outcome path, filled. The verb names the action. */
export const networkRelationshipOutcomePath = (
  relationshipId: string,
  verb: "pass" | "pause" | "resume" | "meeting-outcome",
) => `/v1/network/relationships/${encodeURIComponent(relationshipId)}/${verb}`;

/**
 * Diligence (2026-10-02): a minimal gated document area on a relationship
 * once diligence has started. A share is a disclosure policy on one of the
 * company's own documents for THIS relationship; requests are the
 * investor's. Each verb is its own path.
 */
export const NETWORK_RELATIONSHIP_DILIGENCE_PATH =
  "/v1/network/relationships/:relationshipId/diligence" as const;
export const NETWORK_DILIGENCE_SHARES_PATH =
  "/v1/network/relationships/:relationshipId/diligence/shares" as const;
export const NETWORK_DILIGENCE_SHARE_REVOKE_PATH =
  "/v1/network/relationships/:relationshipId/diligence/shares/:policyId/revoke" as const;
export const NETWORK_DILIGENCE_REQUESTS_PATH =
  "/v1/network/relationships/:relationshipId/diligence/requests" as const;
export const NETWORK_DILIGENCE_REQUEST_FULFIL_PATH =
  "/v1/network/relationships/:relationshipId/diligence/requests/:requestId/fulfil" as const;
export const NETWORK_DILIGENCE_DOWNLOAD_PATH =
  "/v1/network/relationships/:relationshipId/diligence/documents/:documentId/download" as const;

export const diligencePath = (relationshipId: string, rest = "") =>
  `/v1/network/relationships/${encodeURIComponent(relationshipId)}/diligence${rest}`;

export const DiligenceDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    side: z.enum(["INVESTOR", "COMPANY"]),
    open: z.boolean(),
    shares: z
      .array(
        z
          .object({
            policyId: UuidSchema,
            documentId: UuidSchema,
            title: z.string().max(300),
            documentType: z.string().max(64),
            sharedAt: UtcTimestampSchema,
          })
          .strict(),
      )
      .max(200),
    requests: z
      .array(
        z
          .object({
            requestId: UuidSchema,
            title: z.string().max(200),
            note: z.string().max(1000).nullable(),
            requestedAt: UtcTimestampSchema,
            status: z.enum(["OPEN", "FULFILLED"]),
            fulfilledBy: z
              .object({
                documentId: UuidSchema,
                title: z.string().max(300).nullable(),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type DiligenceDto = z.infer<typeof DiligenceDtoSchema>;

export const ShareDiligenceDocumentRequestSchema = z
  .object({ documentId: UuidSchema })
  .strict();
export const RequestDiligenceDocumentRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    note: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
export type RequestDiligenceDocumentRequest = z.infer<
  typeof RequestDiligenceDocumentRequestSchema
>;
export const DiligenceShareResultDtoSchema = z
  .object({ policyId: UuidSchema })
  .strict();
export const DiligenceRequestResultDtoSchema = z
  .object({ requestId: UuidSchema })
  .strict();
export const DiligenceDownloadDtoSchema = z
  .object({ url: z.string().url(), expiresAt: UtcTimestampSchema })
  .strict();
