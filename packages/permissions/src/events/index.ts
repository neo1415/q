import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  defineEvent,
  EventIdSchema,
  UtcTimestampSchema,
  UuidSchema,
  type CapitalQEvent,
  type CorrelationId,
  type EventDefinition,
} from "@capital-q/contracts";

import type { DisclosurePolicy } from "../contracts/index.js";

/**
 * Permissions integration events. Sharing topology is itself sensitive, so
 * both are CONFIDENTIAL and carry identifiers only: no recipient list, no
 * resource content, no reason. Delivery (email, in-app, Data Room links)
 * is a separate consumer concern; nothing is sent by granting.
 */

export const PERMISSIONS_EVENT_OWNER = "@capital-q/permissions" as const;
export const PERMISSIONS_EVENT_PRODUCER = "capitalq://api/permissions" as const;

const ResourceTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);
const ScopeSchema = z.enum([
  "personal_private",
  "organisation_private",
  "founder_private",
  "investor_private",
  "relationship_shared",
  "specifically_shared",
  "network_visible",
  "public_external",
]);

export const DisclosureGrantedEvent = defineEvent({
  name: "permissions.disclosure.granted",
  version: 1,
  owner: PERMISSIONS_EVENT_OWNER,
  producer: PERMISSIONS_EVENT_PRODUCER,
  consumers: ["@capital-q/q", "@capital-q/communication"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      disclosurePolicyId: UuidSchema,
      resourceType: ResourceTypeSchema,
      resourceId: UuidSchema,
      scopeType: ScopeSchema,
      accessLevel: z.enum(["view", "view_download"]),
    })
    .strict(),
  description:
    "A deliberate disclosure policy was created. Identifiers only; the recipient and the resource content stay in the server-only policy table.",
});

export const DisclosureRevokedEvent = defineEvent({
  name: "permissions.disclosure.revoked",
  version: 1,
  owner: PERMISSIONS_EVENT_OWNER,
  producer: PERMISSIONS_EVENT_PRODUCER,
  consumers: ["@capital-q/q", "@capital-q/communication"],
  sensitivity: "CONFIDENTIAL",
  replaySafety: "REPLAY_SAFE",
  dataSchema: z
    .object({
      disclosurePolicyId: UuidSchema,
      resourceType: ResourceTypeSchema,
      resourceId: UuidSchema,
      scopeType: ScopeSchema,
    })
    .strict(),
  description:
    "A disclosure policy was revoked. Future authorised access through it stops; already-received copies are not recalled.",
});

export const PERMISSIONS_EVENTS: readonly EventDefinition[] = [
  DisclosureGrantedEvent,
  DisclosureRevokedEvent,
];

type EmitInput = {
  readonly tenantId: string;
  readonly organisationId: string | undefined;
  readonly actorUserId: string;
  readonly correlationId: CorrelationId;
  readonly policy: DisclosurePolicy;
};

function envelope(input: EmitInput, definition: EventDefinition) {
  return {
    specVersion: "1.0" as const,
    id: EventIdSchema.parse(randomUUID()),
    type: definition.name,
    source: definition.producer,
    time: UtcTimestampSchema.parse(new Date().toISOString()),
    subject: `disclosure_policy/${input.policy.id}`,
    dataContentType: "application/json" as const,
    eventVersion: definition.version,
    tenantId: input.tenantId,
    ...(input.organisationId === undefined
      ? {}
      : { organisationId: input.organisationId }),
    actor: { type: "HUMAN" as const, id: input.actorUserId },
    correlationId: input.correlationId,
    aggregate: { type: "disclosure_policy", id: input.policy.id },
  };
}

export function disclosureGrantedEvent(
  input: EmitInput,
): CapitalQEvent<z.infer<typeof DisclosureGrantedEvent.dataSchema>> {
  return {
    ...envelope(input, DisclosureGrantedEvent),
    data: {
      disclosurePolicyId: input.policy.id,
      resourceType: input.policy.resource.type,
      resourceId: input.policy.resource.id,
      scopeType: input.policy.scopeType,
      accessLevel: input.policy.accessLevel,
    },
  };
}

export function disclosureRevokedEvent(
  input: EmitInput,
): CapitalQEvent<z.infer<typeof DisclosureRevokedEvent.dataSchema>> {
  return {
    ...envelope(input, DisclosureRevokedEvent),
    data: {
      disclosurePolicyId: input.policy.id,
      resourceType: input.policy.resource.type,
      resourceId: input.policy.resource.id,
      scopeType: input.policy.scopeType,
    },
  };
}
