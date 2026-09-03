import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type {
  CorrelationId,
  CreateOrganisationRequest,
} from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import {
  OrganisationCreationConflictError,
  OrganisationReferenceDataError,
} from "../domain/errors.js";
import {
  hashCreateOrganisationRequest,
  hashIdempotencyKey,
} from "../domain/idempotency.js";
import type { MembershipView } from "../domain/organisation.js";
import { organisationSlugFromDisplayName } from "../domain/slug.js";
import {
  membershipCreatedEvent,
  organisationCreatedEvent,
} from "../events/index.js";
import type { OrganisationServiceDependencies } from "./dependencies.js";

/** The seeded template the creator is assigned. Looked up by code, never by id. */
export const INITIAL_ADMIN_ROLE_CODE = "organisation_admin" as const;

const ORGANISATION_CREATED = AuditActionTypeSchema.parse(
  "organisation.created",
);
const ORGANISATION_RESOURCE = AuditResourceTypeSchema.parse("organisation");

export type CreateOrganisationCommand = {
  /** Trusted: the verified session. */
  readonly principal: AuthenticatedPrincipal;
  /** Validated against CreateOrganisationRequestSchema by the caller. */
  readonly input: CreateOrganisationRequest;
  /** The client's Idempotency-Key. Only its hash is stored. */
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/**
 * Bootstrap an organisation workspace for an authenticated Person.
 *
 * A person-scoped command: no organisation context exists yet, so no
 * organisation capability can be required. The authority is the verified
 * session and the Person record behind it -- nothing the client says about
 * itself.
 *
 * One transaction:
 *
 *   Person resolved -> idempotency lock and lookup -> tenant -> organisation
 *   -> tenant link -> active membership -> organisation_admin assignment
 *   -> active context -> audit -> events -> idempotency record -> COMMIT
 *
 * Any failure rolls back everything. A retry with the same key and the same
 * request returns the organisation already created; the same key with a
 * different request is a conflict and creates nothing.
 */
export function createCreateOrganisation(
  dependencies: OrganisationServiceDependencies,
) {
  const {
    transactions,
    identities,
    outbox,
    audit,
    repositories: {
      tenants,
      organisations,
      memberships,
      roleTemplates,
      creationRequests,
    },
  } = dependencies;

  return async (command: CreateOrganisationCommand): Promise<MembershipView> =>
    transactions.run(async (tx) => {
      const identity = await identities(tx.sql).lookup(command.principal);
      if (identity === null) {
        // Authenticated, but no active Person record. Not fabricated here.
        throw new ActorContextDeniedError();
      }
      const userId = identity.userId;

      const keyHash = hashIdempotencyKey(command.idempotencyKey);
      const requestHash = hashCreateOrganisationRequest(command.input);

      await creationRequests.lock(tx, userId, keyHash);
      const previous = await creationRequests.find(tx, userId, keyHash);
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new OrganisationCreationConflictError();
        }
        const existing = await memberships.findActiveForUser(
          tx.sql,
          userId,
          previous.organisationId,
        );
        if (existing === null) {
          // The record exists but the membership no longer does: the
          // original outcome cannot be replayed, and creating a second
          // workspace under the same key is exactly what must not happen.
          throw new OrganisationCreationConflictError();
        }
        return existing;
      }

      // The template must exist as reference data. It is never created
      // on the fly: an invented role would be invented authority.
      const adminRoleId = await roleTemplates.findActiveRoleIdByCode(
        tx,
        INITIAL_ADMIN_ROLE_CODE,
      );
      if (adminRoleId === null) {
        throw new OrganisationReferenceDataError(
          `role template ${INITIAL_ADMIN_ROLE_CODE}`,
        );
      }

      // Separate identifiers for tenant and organisation, always. V1 pairs
      // them one-to-one; nothing here encodes equality.
      const tenantId = await tenants.insert(tx, {
        name: command.input.displayName,
      });
      const organisation = await organisations.insert(tx, {
        tenantId,
        organisationType: command.input.organisationType,
        displayName: command.input.displayName,
        slug: organisationSlugFromDisplayName(command.input.displayName),
        legalName: command.input.legalName ?? null,
        websiteUrl: command.input.websiteUrl ?? null,
        countryCode: command.input.countryCode ?? null,
        jurisdictionCode: command.input.jurisdictionCode ?? null,
      });
      await tenants.linkPrimaryOrganisation(tx, tenantId, organisation.id);

      const membership = await memberships.insert(tx, {
        tenantId,
        organisationId: organisation.id,
        userId,
      });
      await memberships.assignRole(tx, membership.id, adminRoleId);
      await memberships.setActiveContext(tx, userId, membership.id);

      await audit.record(tx, {
        auditEventId: createAuditEventId(),
        tenantId,
        actorType: "HUMAN",
        actorId: userId,
        authorityUserId: userId,
        organisationId: organisation.id,
        actionType: ORGANISATION_CREATED,
        resourceType: ORGANISATION_RESOURCE,
        resourceId: organisation.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { organisationType: organisation.organisationType },
        correlationId: command.correlationId,
      });

      const envelope = {
        tenantId,
        organisationId: organisation.id,
        actorUserId: userId,
        correlationId: command.correlationId,
      };
      await outbox.enqueue(
        tx,
        organisationCreatedEvent({
          ...envelope,
          organisationType: organisation.organisationType,
        }),
      );
      await outbox.enqueue(
        tx,
        membershipCreatedEvent({
          ...envelope,
          membershipId: membership.id,
          userId,
        }),
      );

      await creationRequests.record(tx, {
        userId,
        idempotencyKeyHash: keyHash,
        requestHash,
        organisationId: organisation.id,
        tenantId,
      });

      return {
        organisation,
        membership,
        roleCodes: [INITIAL_ADMIN_ROLE_CODE],
        isActiveContext: true,
      };
    });
}
