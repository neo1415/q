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
    state: RelationshipStateV1Schema,
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
] as const;

export const RelationshipStatusDtoSchema = z
  .object({
    relationshipId: UuidSchema,
    companyId: UuidSchema,
    investorOrganisationId: UuidSchema,
    /** Where are we. */
    state: RelationshipStateV1Schema,
    stateSince: UtcTimestampSchema,
    /** What happened. */
    milestones: z.array(RelationshipMilestoneDtoSchema).max(64),
    /** What is next, for this party. */
    nextStep: z.enum(RELATIONSHIP_NEXT_STEPS),
    projectorVersion: z.string().min(1).max(64),
  })
  .strict();
export type RelationshipStatusDto = z.infer<typeof RelationshipStatusDtoSchema>;

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
