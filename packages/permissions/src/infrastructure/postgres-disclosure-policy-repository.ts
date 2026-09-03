import { z } from "zod";

import { UtcTimestampSchema, UuidSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  DisclosureAccessLevelSchema,
  DisclosurePolicyIdSchema,
  DisclosureRecipientTypeSchema,
  DisclosureResourceTypeSchema,
  DisclosureScopeSchema,
  type DisclosurePolicy,
} from "../contracts/index.js";
import { DisclosurePolicyExistsError } from "../domain/errors.js";
import type { DisclosurePolicyRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for the disclosure policy port. Parameterised SQL
 * only: resource_type, scope_type and recipient_type are always bound as
 * data, never spliced into identifiers, and there is no `SELECT * FROM
 * ${resourceType}` anywhere. The table is server-internal; this adapter
 * runs under the application's trusted connection and exposes no UPDATE
 * of scope, recipient, access level or expiry, and no DELETE.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const Row = z.object({
  id: DisclosurePolicyIdSchema,
  tenant_id: TenantIdSchema,
  owner_organisation_id: OrganisationIdSchema.nullable(),
  owner_user_id: UserIdSchema.nullable(),
  resource_type: DisclosureResourceTypeSchema,
  resource_id: UuidSchema,
  scope_type: DisclosureScopeSchema,
  recipient_type: DisclosureRecipientTypeSchema.nullable(),
  recipient_id: UuidSchema.nullable(),
  access_level: DisclosureAccessLevelSchema,
  expires_at: Timestamp.nullable(),
  created_by_user_id: UserIdSchema,
  created_at: Timestamp,
  revoked_at: Timestamp.nullable(),
});

function toPolicy(row: unknown): DisclosurePolicy {
  const r = Row.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ownerUserId: r.owner_user_id,
    ownerOrganisationId: r.owner_organisation_id,
    resource: { type: r.resource_type, id: r.resource_id },
    scopeType: r.scope_type,
    recipient:
      r.recipient_type === null || r.recipient_id === null
        ? null
        : { type: r.recipient_type, id: r.recipient_id },
    accessLevel: r.access_level,
    expiresAt: r.expires_at,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  };
}

function policySelect(executor: DatabaseExecutor) {
  return executor`
    select p.id, p.tenant_id, p.owner_organisation_id, p.owner_user_id, p.resource_type,
           p.resource_id, p.scope_type, p.recipient_type, p.recipient_id, p.access_level,
           p.expires_at, p.created_by_user_id, p.created_at, p.revoked_at
      from permissions.disclosure_policies p`;
}

/** The exclusion constraint fired: an overlapping active identical grant exists. */
const ExclusionViolation = z.object({ code: z.literal("23P01") });

export function createPostgresDisclosurePolicyRepository(): DisclosurePolicyRepository {
  return {
    insert: async (tx, policy) => {
      try {
        const rows = await tx.sql`
          insert into permissions.disclosure_policies
            (id, tenant_id, owner_organisation_id, owner_user_id, resource_type, resource_id,
             scope_type, recipient_type, recipient_id, access_level, expires_at, created_by_user_id)
          values
            (${policy.id}, ${policy.tenantId}, ${policy.ownerOrganisationId}, ${policy.ownerUserId},
             ${policy.resource.type}, ${policy.resource.id}, ${policy.scopeType},
             ${policy.recipient?.type ?? null}, ${policy.recipient?.id ?? null}, ${policy.accessLevel},
             ${policy.expiresAt}::text::timestamptz, ${policy.createdByUserId})
          returning id`;
        const inserted = z
          .object({ id: DisclosurePolicyIdSchema })
          .parse(rows[0]);
        const created = await tx.sql`
          ${policySelect(tx.sql)} where p.id = ${inserted.id}`;
        return toPolicy(created[0]);
      } catch (error: unknown) {
        if (ExclusionViolation.safeParse(error).success) {
          throw new DisclosurePolicyExistsError();
        }
        throw error;
      }
    },
    findById: async (executor, disclosurePolicyId) => {
      const rows = await executor`
        ${policySelect(executor)} where p.id = ${disclosurePolicyId}`;
      return rows.length === 0 ? null : toPolicy(rows[0]);
    },
    lockById: async (tx, disclosurePolicyId) => {
      const rows = await tx.sql`
        ${policySelect(tx.sql)} where p.id = ${disclosurePolicyId} for update`;
      return rows.length === 0 ? null : toPolicy(rows[0]);
    },
    lockResource: async (tx, resource) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext('permissions.disclosure'),
          hashtext(${resource.type}::text || ':' || ${resource.id}::text))`;
    },
    findUnrevokedForResource: async (executor, resource) => {
      const rows = await executor`
        ${policySelect(executor)}
         where p.resource_type = ${resource.type}
           and p.resource_id = ${resource.id}
           and p.revoked_at is null
         order by p.created_at, p.id`;
      return rows.map(toPolicy);
    },
    findUnrevokedForResources: async (executor, resources) => {
      if (resources.length === 0) {
        return [];
      }
      // Exact (type, id) pairs via unnest: no cross product, bounded by the
      // caller's batch limit.
      const types = resources.map((resource) => resource.type);
      const ids = resources.map((resource) => resource.id);
      const rows = await executor`
        ${policySelect(executor)}
          join unnest(${types}::text[], ${ids}::uuid[]) as wanted (resource_type, resource_id)
            on wanted.resource_type = p.resource_type and wanted.resource_id = p.resource_id
         where p.revoked_at is null
         order by p.created_at, p.id`;
      return rows.map(toPolicy);
    },
    findAllForResource: async (executor, resource) => {
      const rows = await executor`
        ${policySelect(executor)}
         where p.resource_type = ${resource.type}
           and p.resource_id = ${resource.id}
         order by p.created_at, p.id`;
      return rows.map(toPolicy);
    },
    revoke: async (tx, disclosurePolicyId, revokedAt) => {
      const rows = await tx.sql`
        update permissions.disclosure_policies p
           set revoked_at = ${revokedAt}::text::timestamptz
         where p.id = ${disclosurePolicyId}
           and p.revoked_at is null
        returning p.id`;
      if (rows.length === 0) {
        return null;
      }
      const updated = await tx.sql`
        ${policySelect(tx.sql)} where p.id = ${disclosurePolicyId}`;
      return toPolicy(updated[0]);
    },
  };
}
