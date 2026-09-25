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
 * Derived projection vocabulary. Only DISCOVERED exists in this foundation;
 * CQ-NET-012 owns the projector and extends the vocabulary. Bounded text.
 */
export const RELATIONSHIP_CURRENT_STATES = ["DISCOVERED"] as const;
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

/** Unilateral, and only ever EXPRESSED in this packet. */
export const InterestDtoSchema = z
  .object({
    interestId: UuidSchema,
    relationshipId: UuidSchema,
    companyId: UuidSchema,
    status: z.enum(["EXPRESSED", "WITHDRAWN"]),
    expressedAt: UtcTimestampSchema,
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
