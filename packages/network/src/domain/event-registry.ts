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
 * Production registry: `discovered` (CQ-NET-001), `interest_expressed`
 * (CQ-NET-010), `connection_accepted` and `interest_declined` (CQ-NET-011).
 */
export const RELATIONSHIP_EVENT_DEFINITIONS: readonly RelationshipEventDefinition[] =
  [
    DiscoveredRelationshipEvent,
    InterestExpressedRelationshipEvent,
    ConnectionAcceptedRelationshipEvent,
    InterestDeclinedRelationshipEvent,
  ];
