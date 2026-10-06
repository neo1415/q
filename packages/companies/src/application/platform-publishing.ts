import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import type { CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import { companyVisibilityChangedEvent } from "../events/index.js";
import type { CompanyServiceDependencies } from "./dependencies.js";

const PUBLISHED_BY_PLATFORM = AuditActionTypeSchema.parse(
  "company.visibility_changed_by_platform",
);
const COMPANY_RESOURCE = AuditResourceTypeSchema.parse("company");

export type PlatformPublishingOutcome =
  | "CHANGED"
  | "UNCHANGED"
  | "NOT_FOUND"
  /** Someone holds the company: only its own people choose its visibility. */
  | "CLAIMED";

/**
 * P14 item 7: a real company's profile that nobody has claimed yet, made
 * public at an external URL (public_external), or taken back to the
 * network (network_visible), by a platform admin.
 *
 *   public_external ≠ network_visible (ADR-001): public is anyone with the
 *   link; network is authenticated Capital Q participants. Never merged.
 *
 * The caller has already authorised the platform admin (the console's
 * `companies.publish`, with step-up) and records the admin action; this
 * enforces the company-side rule (only an unclaimed company, so a
 * founder's own choice is never overridden), writes the change, audits it
 * on the company and publishes the same visibility event a founder's
 * change does, in one transaction.
 */
export function createPlatformCompanyPublishing(
  dependencies: Pick<
    CompanyServiceDependencies,
    "transactions" | "outbox" | "audit"
  >,
) {
  return (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly publicExternal: boolean;
    readonly reason: string;
    readonly correlationId: CorrelationId;
  }): Promise<PlatformPublishingOutcome> =>
    dependencies.transactions.run(async (tx) => {
      const rows = await tx.sql<
        {
          id: string;
          tenant_id: string;
          organisation_id: string;
          marketplace_visibility: string;
          version: number;
          claimed: boolean;
        }[]
      >`
        select c.id, c.tenant_id, c.organisation_id, c.marketplace_visibility, c.version,
               exists (select 1 from identity.organisation_memberships m
                        where m.organisation_id = c.organisation_id
                          and m.membership_status = 'active') as claimed
          from core.companies c
         where c.id = ${command.companyId} and c.company_status = 'active'
         for update of c`;
      const company = rows[0];
      if (company === undefined) return "NOT_FOUND";
      if (company.claimed) return "CLAIMED";
      const next = command.publicExternal
        ? "public_external"
        : "network_visible";
      if (company.marketplace_visibility === next) return "UNCHANGED";
      const updated = await tx.sql<{ version: number }[]>`
        update core.companies
           set marketplace_visibility = ${next}, version = version + 1
         where id = ${company.id} and version = ${company.version}
        returning version`;
      const version = updated[0]?.version;
      if (version === undefined) return "NOT_FOUND";
      await dependencies.audit.record(tx, {
        ...auditActorFromContext(command.actor),
        auditEventId: createAuditEventId(),
        actionType: PUBLISHED_BY_PLATFORM,
        resourceType: COMPANY_RESOURCE,
        resourceId: company.id,
        occurredAt: occurredNow(),
        outcome: "SUCCEEDED",
        metadata: {
          previousVisibility: company.marketplace_visibility,
          visibility: next,
          via: "PLATFORM_ADMIN",
          reason: command.reason,
        },
        correlationId: command.correlationId,
      });
      await dependencies.outbox.enqueue(
        tx,
        companyVisibilityChangedEvent({
          tenantId: company.tenant_id,
          organisationId: company.organisation_id,
          companyId: company.id,
          version,
          actorUserId: command.actor.userId,
          correlationId: command.correlationId,
          visibility: next,
        }),
      );
      return "CHANGED";
    });
}

export type PlatformCompanyPublishing = ReturnType<
  typeof createPlatformCompanyPublishing
>;
