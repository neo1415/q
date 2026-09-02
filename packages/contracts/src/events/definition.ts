import { z } from "zod";

import type { MessageSensitivity } from "../messaging/sensitivity.js";
import { MessageSensitivitySchema } from "../messaging/sensitivity.js";
import type { ReplaySafety } from "../messaging/replay.js";
import { ReplaySafetySchema } from "../messaging/replay.js";
import { VersionSchema } from "../common/version.js";
import { EventSourceSchema, EventTypeSchema } from "./envelope.js";

/**
 * The declaration of one event type at one version.
 *
 * Recording owner, producer and consumers here is what stops two contexts
 * inventing synonymous events for the same fact -- the failure this registry
 * exists to prevent.
 */
/**
 * Whether an event belongs to a tenant. Absent means TENANT_OWNED: an event
 * must opt out explicitly to be published without a tenantId, so forgetting
 * the field fails closed at the outbox rather than leaking a tenantless
 * business event.
 */
export const EVENT_TENANCIES = ["TENANT_OWNED", "PLATFORM"] as const;
export type EventTenancy = (typeof EVENT_TENANCIES)[number];
export const EventTenancySchema = z.enum(EVENT_TENANCIES);

export type EventDefinition<TData extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly version: number;
  /**
   * The single bounded context that owns this event's meaning. There is no
   * "shared", "platform" or "misc" owner: an event without an owner is an event
   * nobody may change safely.
   */
  readonly owner: string;
  /** Logical producer URI. One owner publishes an event; consumers do not. */
  readonly producer: string;
  /** Architectural intent, not wiring. Consumers evolve additively. */
  readonly consumers: readonly string[];
  readonly sensitivity: MessageSensitivity;
  readonly replaySafety: ReplaySafety;
  readonly tenancy?: EventTenancy | undefined;
  readonly dataSchema: TData;
  readonly description: string;
};

const definitionMetaSchema = z.object({
  name: EventTypeSchema,
  version: VersionSchema,
  owner: z.string().min(1).max(128),
  producer: EventSourceSchema,
  consumers: z.array(z.string().min(1).max(128)),
  sensitivity: MessageSensitivitySchema,
  replaySafety: ReplaySafetySchema,
  tenancy: EventTenancySchema.optional(),
  description: z.string().min(1).max(500),
});

/**
 * Declare an event contract.
 *
 * Metadata is validated here, at construction, so a malformed contract fails
 * when the module loads rather than when the first message is published.
 */
export function defineEvent<TData extends z.ZodType>(
  definition: EventDefinition<TData>,
): EventDefinition<TData> {
  definitionMetaSchema.parse({
    name: definition.name,
    version: definition.version,
    owner: definition.owner,
    producer: definition.producer,
    consumers: definition.consumers,
    sensitivity: definition.sensitivity,
    replaySafety: definition.replaySafety,
    tenancy: definition.tenancy,
    description: definition.description,
  });

  return Object.freeze({ ...definition });
}

/** Registry lookup identity: a type alone does not determine a payload forever. */
/** Tenant-owned unless the definition explicitly declares PLATFORM. */
export function isTenantOwnedEvent(definition: EventDefinition): boolean {
  return (definition.tenancy ?? "TENANT_OWNED") === "TENANT_OWNED";
}

export function eventKey(name: string, version: number): string {
  return `${name}@${String(version)}`;
}
