import { z } from "zod";

import type { ActorType } from "@capital-q/security";

/**
 * Bounded audit vocabularies. Action and resource types are open syntaxes
 * that owning feature packets fill in; outcomes, actor types and severities
 * are closed sets.
 */

/** What happened, as a dotted lowercase noun.verb-in-past-tense phrase. */
export const AuditActionTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "expected a dotted lower_snake_case action type such as permission.granted",
  )
  .max(128)
  .brand<"AuditActionType">();
export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AuditResourceTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case resource type")
  .max(64)
  .brand<"AuditResourceType">();
export type AuditResourceType = z.infer<typeof AuditResourceTypeSchema>;

/** An opaque reference to the resource. Never human-readable private content. */
export const AuditResourceIdSchema = z.string().min(1).max(200);

export const AUDIT_OUTCOMES = ["SUCCEEDED", "FAILED", "DENIED"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
export const AuditOutcomeSchema = z.enum(AUDIT_OUTCOMES);

/** Persisted actor vocabulary (doc 13 §50). */
export const PERSISTED_ACTOR_TYPES = [
  "human",
  "q",
  "capital_q_system",
  "connected_system",
] as const;
export type PersistedActorType = (typeof PERSISTED_ACTOR_TYPES)[number];
export const PersistedActorTypeSchema = z.enum(PERSISTED_ACTOR_TYPES);

/**
 * The one adapter between the application ActorType and the persisted
 * vocabulary. There is no second actor model.
 */
const ACTOR_TYPE_TO_PERSISTED: Record<ActorType, PersistedActorType> = {
  HUMAN: "human",
  Q: "q",
  SYSTEM: "capital_q_system",
  CONNECTED_SYSTEM: "connected_system",
};

export function toPersistedActorType(actorType: ActorType): PersistedActorType {
  return ACTOR_TYPE_TO_PERSISTED[actorType];
}

export const SecurityEventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case security event type")
  .max(64)
  .brand<"SecurityEventType">();
export type SecurityEventType = z.infer<typeof SecurityEventTypeSchema>;

export const SECURITY_SEVERITIES = [
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];
export const SecuritySeveritySchema = z.enum(SECURITY_SEVERITIES);

/**
 * A pseudonymous hash reference: `<algorithm>:<digest>`, e.g.
 * "sha256:9f86d0…". The shape is deliberately incompatible with a raw IP
 * address or user-agent string, so a caller cannot pass one through by
 * mistake.
 */
export const HashReferenceSchema = z
  .string()
  .regex(
    /^[a-z0-9]{2,16}:[A-Za-z0-9+/=_-]{16,128}$/,
    "expected a hash reference of the form <algorithm>:<digest>",
  );
