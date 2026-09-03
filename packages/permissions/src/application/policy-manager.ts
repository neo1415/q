import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type AuditMetadata,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import { CorrelationIdSchema, type CorrelationId } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  ActorContextSchema,
  capability,
  type ActorContext,
  type AuthorizationService,
  type OrganisationId,
  type ResourceScope,
  type UserId,
} from "@capital-q/security";

import {
  DisclosureAccessLevelSchema,
  DisclosurePolicyIdSchema,
  DisclosureRecipientSchema,
  DisclosureResourceRefSchema,
  DisclosureScopeSchema,
  isPolicyActiveAt,
  UtcTimestampSchema,
  type DisclosurePolicy,
  type DisclosurePolicyId,
  type DisclosureRecipient,
  type DisclosureResourceDescriptor,
  type DisclosureResourceRef,
  type RelationshipParties,
  type UtcTimestamp,
} from "../contracts/index.js";
import {
  DisclosurePolicyConflictError,
  DisclosurePolicyInvalidError,
  DisclosurePolicyNotFoundError,
  DisclosureResourceNotFoundError,
} from "../domain/errors.js";
import {
  policyRelationshipId,
  sameCanonicalPolicy,
  sameGrantIdentity,
  validatePolicyShape,
} from "../domain/policy-rules.js";
import {
  disclosureGrantedEvent,
  disclosureRevokedEvent,
} from "../events/index.js";
import type {
  DisclosureClock,
  DisclosurePolicyRepository,
  DisclosureResourceResolverRegistry,
  RelationshipPartyResolver,
} from "./ports.js";

/**
 * Grant and revoke deliberate disclosure. Sharing is consequential:
 *
 *   resolve resource -> derive owner server-side -> authorise
 *   disclosure.manage on the exact resource -> validate scope/recipient ->
 *   [tx] lock resource -> idempotency / duplicate check -> insert ->
 *   audit disclosure.granted -> outbox permissions.disclosure.granted -> COMMIT
 *
 * View ≠ share: an actor who can see a resource, a recipient of a share, a
 * founder, a CEO or a Partner gains nothing here unless their capability
 * mapping grants disclosure.manage over the owning organisation. Owner
 * identity is never an input. Nothing external happens inside the
 * transaction: no email, no signed URL, no notification, no model.
 */

export const DISCLOSURE_MANAGE = capability("disclosure.manage");
export const DISCLOSURE_INSPECT = capability("disclosure.inspect");

export const RESOURCE_DISCLOSURE_POLICY =
  AuditResourceTypeSchema.parse("disclosure_policy");
const ACTION_GRANTED = AuditActionTypeSchema.parse("disclosure.granted");
const ACTION_REVOKED = AuditActionTypeSchema.parse("disclosure.revoked");

export type GrantDisclosureCommand = {
  /** Trusted, server-resolved. Never from a request body. */
  readonly actor: ActorContext;
  /** Generated before the write for retry safety; generated here when absent. */
  readonly disclosurePolicyId?: DisclosurePolicyId | undefined;
  readonly resource: DisclosureResourceRef;
  readonly scopeType: DisclosurePolicy["scopeType"];
  readonly recipient?: DisclosureRecipient | undefined;
  readonly accessLevel: DisclosurePolicy["accessLevel"];
  readonly expiresAt?: UtcTimestamp | undefined;
  readonly correlationId: CorrelationId;
};

const GrantDisclosureCommandSchema = z
  .object({
    actor: ActorContextSchema,
    disclosurePolicyId: DisclosurePolicyIdSchema.optional(),
    resource: DisclosureResourceRefSchema,
    scopeType: DisclosureScopeSchema,
    recipient: DisclosureRecipientSchema.optional(),
    accessLevel: DisclosureAccessLevelSchema,
    expiresAt: UtcTimestampSchema.optional(),
    correlationId: CorrelationIdSchema,
  })
  .strict();

export type GrantDisclosureResult =
  | {
      readonly outcome: "CREATED" | "EXISTING";
      readonly policy: DisclosurePolicy;
    }
  | {
      /** The share would grant nothing the recipient does not already hold. No row is written. */
      readonly outcome: "REDUNDANT";
      readonly policy: null;
      readonly reason: "RECIPIENT_IS_OWNER" | "INTRINSIC_SCOPE_ALREADY_GRANTS";
    };

export type RevokeDisclosureCommand = {
  readonly actor: ActorContext;
  readonly disclosurePolicyId: DisclosurePolicyId;
  readonly correlationId: CorrelationId;
};

const RevokeDisclosureCommandSchema = z
  .object({
    actor: ActorContextSchema,
    disclosurePolicyId: DisclosurePolicyIdSchema,
    correlationId: CorrelationIdSchema,
  })
  .strict();

export type RevokeDisclosureResult = {
  readonly outcome: "REVOKED" | "ALREADY_REVOKED";
  readonly policy: DisclosurePolicy;
};

export type DisclosurePolicyManager = {
  readonly grant: (
    command: GrantDisclosureCommand,
  ) => Promise<GrantDisclosureResult>;
  readonly revoke: (
    command: RevokeDisclosureCommand,
  ) => Promise<RevokeDisclosureResult>;
};

export type DisclosurePolicyManagerDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly outbox: OutboxWriter;
  readonly audit: MaterialActionAuditWriter;
  readonly clock: DisclosureClock;
  readonly policies: DisclosurePolicyRepository;
  readonly resolvers: DisclosureResourceResolverRegistry;
  readonly relationshipParties: RelationshipPartyResolver;
};

type Ownership = {
  readonly ownerUserId: UserId | null;
  readonly ownerOrganisationId: OrganisationId | null;
  readonly scope: ResourceScope;
};

function isParty(actor: ActorContext, parties: RelationshipParties): boolean {
  return (
    actor.organisationId !== undefined &&
    ((actor.organisationId === parties.company.organisationId &&
      actor.tenantId === parties.company.tenantId) ||
      (actor.organisationId === parties.investor.organisationId &&
        actor.tenantId === parties.investor.tenantId))
  );
}

/**
 * Where disclosure authority over this resource is evaluated. Owned
 * resources: the owner organisation in the resource's tenant, so only that
 * organisation's holders of disclosure.manage pass -- an Apex admin never
 * passes for Company A's resource, whatever the request claims. Bilateral
 * resources (a relationship): a canonical party authorises against its own
 * organisation and tenant (ADR 0004); a non-party gets a scope nobody
 * holds authority over.
 */
function authorityScope(
  descriptor: DisclosureResourceDescriptor,
  actor: ActorContext,
  parties: RelationshipParties | null,
): Ownership {
  const ownerUserId = descriptor.ownerUserId ?? null;
  if (descriptor.ownerOrganisationId !== undefined) {
    return {
      ownerUserId,
      ownerOrganisationId: descriptor.ownerOrganisationId,
      scope: {
        kind: "RESOURCE",
        tenantId: descriptor.tenantId,
        organisationId: descriptor.ownerOrganisationId,
        resourceType: descriptor.resource.type,
        resourceId: descriptor.resource.id,
      },
    };
  }
  if (
    parties !== null &&
    actor.organisationId !== undefined &&
    isParty(actor, parties)
  ) {
    return {
      ownerUserId,
      ownerOrganisationId: actor.organisationId,
      scope: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: descriptor.resource.type,
        resourceId: descriptor.resource.id,
      },
    };
  }
  return {
    ownerUserId,
    ownerOrganisationId: null,
    scope: {
      kind: "RESOURCE",
      tenantId: descriptor.tenantId,
      resourceType: descriptor.resource.type,
      resourceId: descriptor.resource.id,
    },
  };
}

function recipientMetadata(
  recipient: DisclosureRecipient | null,
): AuditMetadata {
  return recipient === null
    ? {}
    : { recipientType: recipient.type, recipientId: recipient.id };
}

export function createDisclosurePolicyManager(
  dependencies: DisclosurePolicyManagerDependencies,
): DisclosurePolicyManager {
  const {
    sql,
    transactions,
    authorization,
    outbox,
    audit,
    clock,
    policies,
    resolvers,
    relationshipParties,
  } = dependencies;

  async function partiesFor(
    relationshipId: string | undefined,
  ): Promise<RelationshipParties | null> {
    return relationshipId === undefined
      ? null
      : relationshipParties.resolve(relationshipId);
  }

  const grant = async (
    raw: GrantDisclosureCommand,
  ): Promise<GrantDisclosureResult> => {
    const command = GrantDisclosureCommandSchema.parse(raw);
    const recipient = command.recipient ?? null;
    validatePolicyShape({
      scopeType: command.scopeType,
      recipient,
      accessLevel: command.accessLevel,
    });
    const now = clock.now();
    if (
      command.expiresAt !== undefined &&
      Date.parse(command.expiresAt) <= Date.parse(now)
    ) {
      throw new DisclosurePolicyInvalidError("EXPIRY_IN_PAST");
    }

    // 1. The canonical resource decides ownership. Unknown reads as not found.
    const descriptor = await resolvers.resolve(command.resource);
    if (descriptor === null) {
      throw new DisclosureResourceNotFoundError();
    }

    // 2. Relationship facts, where the policy or the resource names one.
    const policyRelationship = policyRelationshipId({ recipient });
    if (
      policyRelationship !== undefined &&
      descriptor.relationshipId !== undefined &&
      descriptor.relationshipId !== policyRelationship
    ) {
      // A relationship event is only ever shared inside its own relationship.
      throw new DisclosurePolicyInvalidError("RELATIONSHIP_MISMATCH");
    }
    const parties = await partiesFor(
      policyRelationship ?? descriptor.relationshipId,
    );
    if (policyRelationship !== undefined && parties === null) {
      throw new DisclosurePolicyInvalidError("RELATIONSHIP_NOT_FOUND");
    }

    // 3. Authority: disclosure.manage over the exact owning scope.
    const ownership = authorityScope(descriptor, command.actor, parties);
    await authorization.requireCapability({
      actor: command.actor,
      capability: DISCLOSURE_MANAGE,
      resource: ownership.scope,
      ...(parties === null
        ? {}
        : { context: { relationshipId: parties.relationshipId } }),
    });

    // 4. Owner invariants and relationship coherence.
    if (
      command.scopeType === "personal_private" &&
      ownership.ownerUserId === null
    ) {
      throw new DisclosurePolicyInvalidError("PERSONAL_OWNER_REQUIRED");
    }
    if (
      ownership.ownerUserId === null &&
      ownership.ownerOrganisationId === null
    ) {
      throw new DisclosurePolicyInvalidError("OWNER_UNRESOLVED");
    }
    if (
      parties !== null &&
      policyRelationship !== undefined &&
      ownership.ownerOrganisationId !== null &&
      ownership.ownerOrganisationId !== parties.company.organisationId &&
      ownership.ownerOrganisationId !== parties.investor.organisationId
    ) {
      throw new DisclosurePolicyInvalidError("OWNER_NOT_RELATIONSHIP_PARTY");
    }

    // 5. Grant-to-self is a no-op, not a row (§195).
    if (
      recipient !== null &&
      ((recipient.type === "USER" && recipient.id === ownership.ownerUserId) ||
        (recipient.type === "ORGANISATION" &&
          recipient.id === ownership.ownerOrganisationId))
    ) {
      return {
        outcome: "REDUNDANT",
        policy: null,
        reason: "RECIPIENT_IS_OWNER",
      };
    }
    if (
      recipient === null &&
      descriptor.intrinsicScope !== undefined &&
      descriptor.intrinsicScope === command.scopeType &&
      command.accessLevel === "view"
    ) {
      return {
        outcome: "REDUNDANT",
        policy: null,
        reason: "INTRINSIC_SCOPE_ALREADY_GRANTS",
      };
    }

    const proposed = {
      id:
        command.disclosurePolicyId ??
        DisclosurePolicyIdSchema.parse(randomUUID()),
      tenantId: descriptor.tenantId,
      ownerUserId: ownership.ownerUserId,
      ownerOrganisationId: ownership.ownerOrganisationId,
      resource: command.resource,
      scopeType: command.scopeType,
      recipient,
      accessLevel: command.accessLevel,
      expiresAt: command.expiresAt ?? null,
      createdByUserId: command.actor.userId,
    };

    return transactions.run(async (tx) => {
      await policies.lockResource(tx, command.resource);

      // Same id: identical -> idempotent; different -> conflict, untouched.
      const byId = await policies.findById(tx.sql, proposed.id);
      if (byId !== null) {
        if (sameCanonicalPolicy(byId, proposed)) {
          return { outcome: "EXISTING", policy: byId };
        }
        throw new DisclosurePolicyConflictError();
      }

      // Semantically identical active grant: one canonical row, no clutter.
      const existing = (
        await policies.findUnrevokedForResource(tx.sql, command.resource)
      ).find(
        (candidate) =>
          isPolicyActiveAt(candidate, now) &&
          sameGrantIdentity(candidate, proposed),
      );
      if (existing !== undefined) {
        return { outcome: "EXISTING", policy: existing };
      }

      const policy = await policies.insert(tx, proposed);
      await audit.record(tx, {
        ...auditActorFromContext(command.actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_GRANTED,
        resourceType: RESOURCE_DISCLOSURE_POLICY,
        resourceId: policy.id,
        ...(parties === null ? {} : { relationshipId: parties.relationshipId }),
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          disclosurePolicyId: policy.id,
          resourceType: policy.resource.type,
          resourceId: policy.resource.id,
          scopeType: policy.scopeType,
          accessLevel: policy.accessLevel,
          ...(policy.expiresAt === null ? {} : { expiresAt: policy.expiresAt }),
          ...recipientMetadata(policy.recipient),
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        disclosureGrantedEvent({
          tenantId: policy.tenantId,
          organisationId:
            command.actor.organisationId ??
            ownership.ownerOrganisationId ??
            undefined,
          actorUserId: command.actor.userId,
          correlationId: command.correlationId,
          policy,
        }),
      );
      return { outcome: "CREATED", policy };
    });
  };

  const revoke = async (
    raw: RevokeDisclosureCommand,
  ): Promise<RevokeDisclosureResult> => {
    const command = RevokeDisclosureCommandSchema.parse(raw);

    // Existence is confirmed only after authority is established, so an
    // unauthorised caller learns nothing from the error they receive.
    const current = await policies.findById(sql, command.disclosurePolicyId);
    if (current === null) {
      throw new DisclosurePolicyNotFoundError();
    }
    const descriptor = await resolvers.resolve(current.resource);
    const parties = await partiesFor(
      policyRelationshipId(current) ?? descriptor?.relationshipId,
    );
    // A resource that can no longer be resolved is authorised from the
    // policy's own recorded owner, so an orphaned share can still be closed.
    const ownership =
      descriptor === null
        ? {
            scope: {
              kind: "RESOURCE" as const,
              tenantId: current.tenantId,
              ...(current.ownerOrganisationId === null
                ? {}
                : { organisationId: current.ownerOrganisationId }),
              resourceType: current.resource.type,
              resourceId: current.resource.id,
            },
          }
        : authorityScope(descriptor, command.actor, parties);
    await authorization.requireCapability({
      actor: command.actor,
      capability: DISCLOSURE_MANAGE,
      resource: ownership.scope,
    });

    return transactions.run(async (tx) => {
      const locked = await policies.lockById(tx, command.disclosurePolicyId);
      if (locked === null) {
        throw new DisclosurePolicyNotFoundError();
      }
      if (locked.revokedAt !== null) {
        return { outcome: "ALREADY_REVOKED", policy: locked };
      }
      const revoked = await policies.revoke(
        tx,
        command.disclosurePolicyId,
        clock.now(),
      );
      if (revoked === null) {
        return { outcome: "ALREADY_REVOKED", policy: locked };
      }
      await audit.record(tx, {
        ...auditActorFromContext(command.actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_REVOKED,
        resourceType: RESOURCE_DISCLOSURE_POLICY,
        resourceId: revoked.id,
        ...(parties === null ? {} : { relationshipId: parties.relationshipId }),
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          disclosurePolicyId: revoked.id,
          resourceType: revoked.resource.type,
          resourceId: revoked.resource.id,
          scopeType: revoked.scopeType,
          ...recipientMetadata(revoked.recipient),
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        disclosureRevokedEvent({
          tenantId: revoked.tenantId,
          organisationId:
            command.actor.organisationId ??
            revoked.ownerOrganisationId ??
            undefined,
          actorUserId: command.actor.userId,
          correlationId: command.correlationId,
          policy: revoked,
        }),
      );
      return { outcome: "REVOKED", policy: revoked };
    });
  };

  return { grant, revoke };
}
