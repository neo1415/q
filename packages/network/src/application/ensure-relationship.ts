import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CompanyId } from "@capital-q/companies";
import type {
  CorrelationId,
  DisclosureScope,
  RelationshipSourceType,
} from "@capital-q/contracts";
import type { InvestorOrganisationId } from "@capital-q/investors";
import type { ActorContext } from "@capital-q/security";

import type { Relationship } from "../contracts/index.js";
import { RelationshipPartyNotFoundError } from "../domain/errors.js";
import { RELATIONSHIP_EVENT_DISCOVERED } from "../domain/event-registry.js";
import { relationshipCreatedEvent } from "../events/index.js";
import { createRelationshipEventAppender } from "./append-event.js";
import type { NetworkServiceDependencies } from "./dependencies.js";

export const RESOURCE_RELATIONSHIP =
  AuditResourceTypeSchema.parse("relationship");
const ACTION_CREATED = AuditActionTypeSchema.parse("relationship.created");

/**
 * Internal primitive for owning workflows. There is no HTTP route for it:
 * relationships emerge from legitimate capital-network actions (Express
 * Interest, a GateQ connection request, ...) that authorise first and then
 * call this inside their own command.
 */
export type EnsureRelationshipCommand = {
  /** Trusted, server-resolved. Supplies the human actor for history, audit and events. */
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
  readonly investorOrganisationId: InvestorOrganisationId;
  /** Provenance of this encounter. Never part of relationship identity. */
  readonly source: {
    readonly type: RelationshipSourceType;
    readonly id?: string | undefined;
  };
  /**
   * The scope of the origin event, decided by the owning workflow (an
   * investor discovering privately -> investor_private; a founder targeting
   * privately -> founder_private). Required: discovery is never defaulted to
   * relationship_shared.
   */
  readonly visibilityScope: DisclosureScope;
  readonly correlationId: CorrelationId;
};

export type EnsuredRelationship = {
  readonly relationship: Relationship;
  /** True only for the caller that materially created the pair. */
  readonly created: boolean;
};

/**
 * Resolve both parties canonically, return the existing pair, or atomically
 * create it:
 *
 *   pair lookup -> transaction: pair advisory lock -> re-check -> insert
 *   (tenant = company tenant, DISCOVERED, first_discovered_at = now) ->
 *   sequence 1 `discovered` history event -> audit relationship.created
 *   -> network.relationship.created -> COMMIT
 *
 * An existing pair is returned untouched: no state change, no second origin
 * event, no second domain event, and first_discovered_at never moves.
 * Company and investor tenants may differ; that is expected.
 */
export function createEnsureRelationship(
  dependencies: NetworkServiceDependencies,
) {
  const { transactions, companies, investors, outbox, audit, repositories } =
    dependencies;
  const appender = createRelationshipEventAppender(dependencies);

  return async (
    command: EnsureRelationshipCommand,
  ): Promise<EnsuredRelationship> => {
    const company = await companies.findCanonicalCompany(command.companyId);
    if (company === null) {
      throw new RelationshipPartyNotFoundError("company");
    }
    const investor = await investors.findCanonicalInvestorOrganisation(
      command.investorOrganisationId,
    );
    if (investor === null) {
      throw new RelationshipPartyNotFoundError("investor_organisation");
    }

    const existing = await repositories.relationships.findByParties(
      dependencies.sql,
      company.id,
      investor.id,
    );
    if (existing !== null) {
      return { relationship: existing, created: false };
    }

    return transactions.run(async (tx) => {
      await repositories.relationships.lockPair(tx, company.id, investor.id);
      const raced = await repositories.relationships.findByParties(
        tx.sql,
        company.id,
        investor.id,
      );
      if (raced !== null) {
        return { relationship: raced, created: false };
      }

      const relationship = await repositories.relationships.insert(tx, {
        tenantId: company.tenantId,
        companyId: company.id,
        investorOrganisationId: investor.id,
      });
      await appender.append(tx, {
        relationshipId: relationship.id,
        eventType: RELATIONSHIP_EVENT_DISCOVERED,
        occurredAt: relationship.firstDiscoveredAt,
        actor: { type: command.actor.actorType, id: command.actor.userId },
        source: command.source,
        visibilityScope: command.visibilityScope,
        payload:
          command.source.id === undefined
            ? {}
            : { sourceReference: command.source.id },
        correlationId: command.correlationId,
      });
      await audit.record(tx, {
        ...auditActorFromContext(command.actor),
        auditEventId: createAuditEventId(),
        actionType: ACTION_CREATED,
        resourceType: RESOURCE_RELATIONSHIP,
        resourceId: relationship.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          companyId: company.id,
          investorOrganisationId: investor.id,
          sourceType: command.source.type,
        },
        correlationId: command.correlationId,
      });
      await outbox.enqueue(
        tx,
        relationshipCreatedEvent({
          tenantId: relationship.tenantId,
          organisationId:
            command.actor.organisationId ?? company.organisationId,
          actorUserId: command.actor.userId,
          correlationId: command.correlationId,
          relationshipId: relationship.id,
          companyId: company.id,
          investorOrganisationId: investor.id,
        }),
      );
      const created = await repositories.relationships.findById(
        tx.sql,
        relationship.id,
      );
      return { relationship: created ?? relationship, created: true };
    });
  };
}
