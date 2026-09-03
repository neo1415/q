import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import {
  COMPANY_EDITABLE_FIELDS,
  type CompanyEditableField,
  type CorrelationId,
  type UpdateCompanyRequest,
} from "@capital-q/contracts";
import { capability, type ActorContext } from "@capital-q/security";

import type { Company, CompanyId } from "../contracts/index.js";
import {
  CompanyNotFoundError,
  CompanyVersionConflictError,
} from "../domain/errors.js";
import { companyUpdatedEvent } from "../events/index.js";
import type { CompanyServiceDependencies } from "./dependencies.js";
import type { CompanyProfileChanges } from "./ports.js";

export const COMPANY_EDIT = capability("company.edit");

const COMPANY_UPDATED = AuditActionTypeSchema.parse("company.updated");
const COMPANY_RESOURCE = AuditResourceTypeSchema.parse("company");

export type UpdateCompanyCommand = {
  readonly actor: ActorContext;
  readonly companyId: CompanyId;
  /** Validated against UpdateCompanyRequestSchema by the caller. */
  readonly input: UpdateCompanyRequest;
  readonly correlationId: CorrelationId;
};

/**
 * Edit the company profile.
 *
 * Same tenant and active organisation (enumeration-safe otherwise),
 * `company.edit` on the exact company scope, then an optimistic write:
 * the row is locked, the stored version must equal `expectedVersion`, and
 * the update increments it. Slug, status, visibility, readiness and the
 * logo key are not reachable from here.
 */
export function createUpdateCompany(dependencies: CompanyServiceDependencies) {
  const { sql, transactions, authorization, outbox, audit, repositories } =
    dependencies;

  return async (command: UpdateCompanyCommand): Promise<Company> => {
    const { actor } = command;
    if (actor.organisationId === undefined) {
      throw new CompanyNotFoundError();
    }
    const organisationId = actor.organisationId;

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

      const changes = effectiveChanges(current, command.input);
      const changedFields = Object.keys(changes) as CompanyEditableField[];
      if (changedFields.length === 0) {
        return current;
      }

      const updated = await repositories.companies.updateProfile(tx, {
        tenantId: actor.tenantId,
        organisationId,
        companyId: command.companyId,
        expectedVersion: current.version,
        changes,
      });
      if (updated === null) {
        throw new CompanyVersionConflictError(current.version);
      }

      await audit.record(tx, {
        ...auditActorFromContext(actor),
        auditEventId: createAuditEventId(),
        actionType: COMPANY_UPDATED,
        resourceType: COMPANY_RESOURCE,
        resourceId: updated.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          changedFields: [...changedFields],
          previousVersion: current.version,
          newVersion: updated.version,
        },
        correlationId: command.correlationId,
      });

      await outbox.enqueue(
        tx,
        companyUpdatedEvent({
          tenantId: actor.tenantId,
          organisationId,
          companyId: updated.id,
          version: updated.version,
          actorUserId: actor.userId,
          correlationId: command.correlationId,
          changedFields,
        }),
      );

      return updated;
    });
  };
}

/** Only fields whose value actually differs from the stored profile. */
function effectiveChanges(
  current: Company,
  input: UpdateCompanyRequest,
): CompanyProfileChanges {
  const changes: Record<string, string | null> = {};
  for (const field of COMPANY_EDITABLE_FIELDS) {
    const next = input[field];
    if (next !== undefined && next !== current[field]) {
      changes[field] = next;
    }
  }
  return changes;
}
