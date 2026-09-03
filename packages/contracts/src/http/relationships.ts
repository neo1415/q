import { z } from "zod";

import { CorrelationIdSchema, UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { MarketplaceVisibilitySchema } from "./companies.js";

/**
 * Relationship contracts (CQ-NET-001).
 *
 * There is deliberately NO HTTP route for relationships in this packet: the
 * disclosure layer (CQ-PERM-001) has not decided what each party may see.
 * These are the safe vocabularies and DTO shapes later routes and consumers
 * will use. A relationship existing is not a disclosure permission, and no
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
