import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type {
  CorrelationId,
  SetCompanyVisibilityRequest,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import type { Company, CompanyId } from "../contracts/index.js";
import {
  CompanyNotFoundError,
  CompanyVersionConflictError,
} from "../domain/errors.js";
import {
  COMPANY_VISIBILITY_CHOICES,
  type CompanyVisibilityChoice,
} from "../domain/network-projection.js";
import { companyVisibilityChangedEvent } from "../events/index.js";
import type { CompanyServiceDependencies } from "./dependencies.js";

const COMPANY_EDIT = capability("company.edit");
const COMPANY_VISIBILITY_CHANGED = AuditActionTypeSchema.parse(
  "company.visibility_changed",
);
const COMPANY_RESOURCE = AuditResourceTypeSchema.parse("company");

export type SetCompanyVisibilityCommand = {
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
  /** Validated against SetCompanyVisibilityRequestSchema by the caller. */
  readonly input: SetCompanyVisibilityRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Publish the declared company profile to investors across the network, or
 * take it back (CQ-PRE-REC-001 §31-§35).
 *
 * An intentional act by an editor of the company — never a side effect of
 * finishing onboarding, of a document being processed or of anything Q
 * read. The only two states a founder can choose are private to the
 * organisation and visible to the network; the row's visibility is the
 * single source the disclosure layer, Q's company tools and the founder's
 * own preview all read. Marketplace readiness is a separate state that this
 * does not touch and does not pretend to assess.
 */
export function createSetCompanyVisibility(
  dependencies: CompanyServiceDependencies,
) {
  const { sql, transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (command: SetCompanyVisibilityCommand): Promise<Company> => {
    const { actor } = command;
    if (actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }
    const organisationId = actor.organisationId;
    const visibility: CompanyVisibilityChoice = command.input.visibility;
    if (!COMPANY_VISIBILITY_CHOICES.includes(visibility)) {
      throw new CompanyNotFoundError();
    }

    const visible = await repositories.companies.findById(
      sql,
      actor.tenantId,
      organisationId,
      command.companyId,
    );
    if (visible === null) {
      throw new CompanyNotFoundError();
    }

    await authorization.requireCapability({
      actor,
      capability: COMPANY_EDIT,
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId,
        resourceType: "company",
        resourceId: visible.id,
      },
    });

    return transactions.run(async (tx) => {
      const current = await repositories.companies.lockById(
        tx,
        actor.tenantId,
        organisationId,
        command.companyId,
      );
      if (current === null) {
        throw new CompanyNotFoundError();
      }
      if (current.version !== command.input.expectedVersion) {
        throw new CompanyVersionConflictError(current.version);
      }
      if (current.marketplaceVisibility === visibility) {
        return current;
      }

      const updated = await repositories.companies.updateVisibility(tx, {
        tenantId: actor.tenantId,
        organisationId,
        companyId: command.companyId,
        expectedVersion: current.version,
        visibility,
      });
      if (updated === null) {
        throw new CompanyVersionConflictError(current.version);
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: COMPANY_VISIBILITY_CHANGED,
        resourceType: COMPANY_RESOURCE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          previousVisibility: current.marketplaceVisibility,
          visibility: updated.marketplaceVisibility,
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        companyVisibilityChangedEvent({
          tenantId: actor.tenantId,
          organisationId,
          companyId: updated.id,
          version: updated.version,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          visibility: updated.marketplaceVisibility,
        }),
      );

      return updated;
    });
  };
}
