import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type {
  CorrelationId,
  CreateInvestorOrganisationRequest,
} from "@capital-q/contracts";
import {
  ActorContextDeniedError,
  ActorContextRequiredError,
  capability,
  type ActorContext,
} from "@capital-q/security";

import type { InvestorOrganisation } from "../contracts/index.js";
import {
  InvestorCreationConflictError,
  InvestorOrganisationExistsError,
} from "../domain/errors.js";
import {
  hashCreateInvestorOrganisationRequest,
  hashInvestorIdempotencyKey,
} from "../domain/idempotency.js";
import {
  investorOrganisationCreatedEvent,
  investorRepresentativeCreatedEvent,
} from "../events/index.js";
import type { InvestorServiceDependencies } from "./dependencies.js";

export const INVESTOR_CREATE = capability("investor.create");

const ACTION_CREATED = AuditActionTypeSchema.parse(
  "investor_organisation.created",
);
const ACTION_REPRESENTATIVE_CREATED = AuditActionTypeSchema.parse(
  "investor_representative.created",
);
const RESOURCE_INVESTOR = AuditResourceTypeSchema.parse(
  "investor_organisation",
);
const RESOURCE_REPRESENTATIVE = AuditResourceTypeSchema.parse(
  "investor_representative",
);

export type CreateInvestorOrganisationCommand = {
  /** Trusted: server-resolved for this request. Supplies tenant, organisation and membership. */
  readonly actor: ActorContext;
  /** Validated against CreateInvestorOrganisationRequestSchema by the caller. */
  readonly input: CreateInvestorOrganisationRequest;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

/**
 * Establish the canonical Investor Organisation of the caller's active
 * organisation.
 *
 *   organisation context required -> organisation still active (query port)
 *   -> investor.create on the ORGANISATION scope -> transaction:
 *   idempotency lock/lookup -> per-organisation lock -> "already
 *   established?" -> investor row -> creator's representative row -> audit
 *   -> core.investor_organisation.created + core.investor_representative.created
 *   -> idempotency record -> COMMIT
 *
 * Tenant, organisation and membership come from the ActorContext, never the
 * request. Profile fields absent from the request default from the
 * organisation's ordinary profile (name, website, country). Nothing else is
 * created: no organisation, no membership, no mandate, no fund vehicle, no
 * GateQ rule set, no verification. The creator's representative row is
 * attribution, not authority.
 */
export function createCreateInvestorOrganisation(
  dependencies: InvestorServiceDependencies,
) {
  const {
    transactions,
    authorization,
    organisations,
    outbox,
    audit,
    repositories: { investors, representatives, creationRequests },
  } = dependencies;

  return async (
    command: CreateInvestorOrganisationCommand,
  ): Promise<InvestorOrganisation> => {
    const { actor, input } = command;
    if (
      actor.organisationId === undefined ||
      actor.membershipId === undefined
    ) {
      throw new ActorContextRequiredError();
    }
    const organisationId = actor.organisationId;
    const membershipId = actor.membershipId;

    // The context proves membership; the query port proves the workspace is
    // still an active organisation. A suspended or closed organisation
    // cannot become an investor, and the caller is not told which.
    const organisation = await organisations.getActiveOrganisationIdentity(
      actor.tenantId,
      organisationId,
    );
    if (organisation === null) {
      throw new ActorContextDeniedError();
    }

    await authorization.requireCapability({
      actor,
      capability: INVESTOR_CREATE,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId,
      },
    });

    const keyHash = hashInvestorIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateInvestorOrganisationRequest(input);

    return transactions.run(async (tx) => {
      await creationRequests.lock(tx, actor.userId, organisationId, keyHash);
      const previous = await creationRequests.find(
        tx,
        actor.userId,
        organisationId,
        keyHash,
      );
      if (previous !== null) {
        if (previous.requestHash !== requestHash) {
          throw new InvestorCreationConflictError();
        }
        const existing = await investors.findById(
          tx.sql,
          actor.tenantId,
          organisationId,
          previous.investorOrganisationId,
        );
        if (existing === null) {
          throw new InvestorCreationConflictError();
        }
        return existing;
      }

      // One canonical investor identity per organisation. The lock closes
      // the race between two first-time creators; the unique constraint on
      // organisation_id is the last line.
      await investors.lockOrganisation(tx, organisationId);
      const established = await investors.findByOrganisation(
        tx.sql,
        actor.tenantId,
        organisationId,
      );
      if (established !== null) {
        throw new InvestorOrganisationExistsError();
      }

      const investor = await investors.insert(tx, {
        tenantId: actor.tenantId,
        organisationId,
        investorType: input.investorType,
        displayName: input.displayName ?? organisation.displayName,
        websiteUrl: input.websiteUrl ?? organisation.websiteUrl,
        hqCountry: input.hqCountry ?? organisation.countryCode,
        publicDescription: input.publicDescription ?? null,
        deploymentState: input.deploymentState ?? null,
      });

      const representative = await representatives.create(tx, {
        tenantId: actor.tenantId,
        investorOrganisationId: investor.id,
        organisationId,
        userId: actor.userId,
        membershipId,
        businessTitle: null,
      });

      const context = {
        tenantId: actor.tenantId,
        organisationId,
        actorUserId: actor.userId,
        correlationId: command.correlationId,
      };

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_CREATED,
        resourceType: RESOURCE_INVESTOR,
        resourceId: investor.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { investorType: investor.investorType },
        correlationId: command.correlationId,
      });
      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_REPRESENTATIVE_CREATED,
        resourceType: RESOURCE_REPRESENTATIVE,
        resourceId: representative.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: { investorOrganisationId: investor.id },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        investorOrganisationCreatedEvent({
          ...context,
          investorOrganisationId: investor.id,
          investorType: investor.investorType,
          version: investor.version,
        }),
      );
      await outbox.enqueue(
        tx,
        investorRepresentativeCreatedEvent({
          ...context,
          investorRepresentativeId: representative.id,
          investorOrganisationId: investor.id,
          userId: actor.userId,
          membershipId,
          version: representative.version,
        }),
      );

      await creationRequests.record(tx, {
        userId: actor.userId,
        organisationId,
        idempotencyKeyHash: keyHash,
        requestHash,
        investorOrganisationId: investor.id,
        tenantId: actor.tenantId,
      });

      return investor;
    });
  };
}
