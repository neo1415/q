import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import type {
  MembershipView,
  OrganisationIdentity,
} from "../domain/organisation.js";
import type {
  CreationRequestRecord,
  MembershipRepository,
  OrganisationCreationRequestStore,
  OrganisationProfileChanges,
  OrganisationQueryPort,
  OrganisationRepository,
  RoleTemplateRepository,
  TenantRepository,
} from "../application/ports.js";
import {
  MembershipViewRowSchema,
  OrganisationRowSchema,
  toMembership,
  toOrganisation,
} from "./rows.js";

/**
 * PostgreSQL adapters for the organisation ports. Parameterised SQL on the
 * executor or transaction the caller supplies; no pools are opened here.
 * Every tenant-owned statement names the tenant.
 */

const IdRowSchema = z.object({ id: z.string() });

export function createPostgresTenantRepository(): TenantRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.tenants (name)
        values (${input.name})
        returning id`;
      return TenantIdSchema.parse(IdRowSchema.parse(rows[0]).id);
    },
    linkPrimaryOrganisation: async (tx, tenantId, organisationId) => {
      await tx.sql`
        insert into identity.tenant_organisations (tenant_id, organisation_id, relationship_type)
        values (${tenantId}, ${organisationId}, 'primary')`;
    },
  };
}

/** The organisation projection, selected identically everywhere. */
function organisationSelect(executor: DatabaseExecutor) {
  return executor`
    select o.id, o.tenant_id, o.organisation_type, o.legal_name, o.display_name, o.slug,
           o.website_url, o.country_code, o.jurisdiction_code, o.status, o.version,
           o.created_at, o.updated_at
      from identity.organisations o`;
}

export function createPostgresOrganisationRepository(): OrganisationRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into identity.organisations
          (tenant_id, organisation_type, display_name, slug, legal_name,
           website_url, country_code, jurisdiction_code)
        values
          (${input.tenantId}, ${input.organisationType}, ${input.displayName},
           ${input.slug}, ${input.legalName}, ${input.websiteUrl},
           ${input.countryCode}, ${input.jurisdictionCode})
        returning id, tenant_id, organisation_type, legal_name, display_name, slug,
                  website_url, country_code, jurisdiction_code, status, version,
                  created_at, updated_at`;
      return toOrganisation(rows[0]);
    },

    findById: async (executor, tenantId, organisationId) => {
      const rows = await executor`
        ${organisationSelect(executor)}
         where o.id = ${organisationId}
           and o.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toOrganisation(rows[0]);
    },

    lockById: async (tx, tenantId, organisationId) => {
      const rows = await tx.sql`
        ${organisationSelect(tx.sql)}
         where o.id = ${organisationId}
           and o.tenant_id = ${tenantId}
           for update`;
      return rows.length === 0 ? null : toOrganisation(rows[0]);
    },

    updateProfile: async (tx, input) => {
      const columns = toColumnChanges(input.changes);
      const rows = await tx.sql`
        update identity.organisations o
           set ${tx.sql(columns)},
               version = o.version + 1
         where o.id = ${input.organisationId}
           and o.tenant_id = ${input.tenantId}
           and o.version = ${input.expectedVersion}
        returning o.id, o.tenant_id, o.organisation_type, o.legal_name, o.display_name, o.slug,
                  o.website_url, o.country_code, o.jurisdiction_code, o.status, o.version,
                  o.created_at, o.updated_at`;
      return rows.length === 0 ? null : toOrganisation(rows[0]);
    },
  };
}

/** Whitelisted column mapping. Unknown keys cannot reach the statement. */
function toColumnChanges(
  changes: OrganisationProfileChanges,
): Record<string, string | null> {
  const columns: Record<string, string | null> = {};
  if (changes.displayName !== undefined) {
    columns["display_name"] = changes.displayName;
  }
  if (changes.legalName !== undefined) {
    columns["legal_name"] = changes.legalName;
  }
  if (changes.websiteUrl !== undefined) {
    columns["website_url"] = changes.websiteUrl;
  }
  if (changes.countryCode !== undefined) {
    columns["country_code"] = changes.countryCode;
  }
  if (changes.jurisdictionCode !== undefined) {
    columns["jurisdiction_code"] = changes.jurisdictionCode;
  }
  return columns;
}

/**
 * The membership view: the caller's active membership, the organisation it
 * belongs to (same tenant, enforced by the join), the currently valid role
 * codes and whether this membership is the persisted active context.
 */
function membershipViewSelect(executor: DatabaseExecutor) {
  return executor`
    select m.id as membership_id,
           m.tenant_id as membership_tenant_id,
           m.organisation_id as membership_organisation_id,
           m.user_id as membership_user_id,
           m.membership_status,
           to_char(m.joined_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as joined_at,
           coalesce(
             (select array_agg(r.code order by r.code)
                from identity.membership_roles mr
                join permissions.roles r on r.id = mr.role_id and r.status = 'active'
               where mr.membership_id = m.id
                 and mr.valid_from <= now()
                 and (mr.valid_until is null or mr.valid_until > now())),
             '{}'::text[]) as role_codes,
           exists (select 1 from identity.user_active_contexts c
                    where c.user_id = m.user_id and c.membership_id = m.id) as is_active_context,
           jsonb_build_object(
             'id', o.id, 'tenant_id', o.tenant_id, 'organisation_type', o.organisation_type,
             'legal_name', o.legal_name, 'display_name', o.display_name, 'slug', o.slug,
             'website_url', o.website_url, 'country_code', o.country_code,
             'jurisdiction_code', o.jurisdiction_code, 'status', o.status, 'version', o.version,
             'created_at', o.created_at, 'updated_at', o.updated_at) as organisation
      from identity.organisation_memberships m
      join identity.organisations o
        on o.id = m.organisation_id and o.tenant_id = m.tenant_id`;
}

function toMembershipView(row: unknown): MembershipView {
  const parsed = MembershipViewRowSchema.parse(row);
  return {
    organisation: toOrganisation(parsed.organisation),
    membership: {
      id: parsed.membership_id,
      tenantId: parsed.membership_tenant_id,
      organisationId: parsed.membership_organisation_id,
      userId: parsed.membership_user_id,
      status: parsed.membership_status,
      joinedAt: parsed.joined_at,
    },
    roleCodes: parsed.role_codes,
    isActiveContext: parsed.is_active_context,
  };
}

export function createPostgresMembershipRepository(): MembershipRepository {
  return {
    insert: async (tx, input) => {
      // No title, no invitation, no metadata: a bootstrap membership is a
      // link between a person and the organisation they just created.
      const rows = await tx.sql`
        insert into identity.organisation_memberships
          (tenant_id, organisation_id, user_id, membership_status, joined_at)
        values (${input.tenantId}, ${input.organisationId}, ${input.userId}, 'active', now())
        returning id, tenant_id, organisation_id, user_id, membership_status, joined_at`;
      return toMembership(rows[0]);
    },

    assignRole: async (tx, membershipId, roleId) => {
      await tx.sql`
        insert into identity.membership_roles (membership_id, role_id, valid_from)
        values (${membershipId}, ${roleId}, now())`;
    },

    setActiveContext: async (tx, userId, membershipId) => {
      await tx.sql`
        insert into identity.user_active_contexts (user_id, membership_id)
        values (${userId}, ${membershipId})
        on conflict (user_id) do update
          set membership_id = excluded.membership_id,
              updated_at = now()`;
    },

    listActiveForUser: async (executor, userId, page) => {
      // The cursor timestamp is bound as text and cast inside SQL: a parameter
      // typed timestamptz would be serialised through a JavaScript Date and
      // lose the microseconds the ordering key carries.
      const rows =
        page.after === undefined
          ? await executor`
              ${membershipViewSelect(executor)}
               where m.user_id = ${userId}
                 and m.membership_status = 'active'
               order by m.joined_at, m.id
               limit ${page.limit}`
          : await executor`
              ${membershipViewSelect(executor)}
               where m.user_id = ${userId}
                 and m.membership_status = 'active'
                 and (m.joined_at, m.id) > (${page.after.joinedAt}::text::timestamptz, ${page.after.id}::uuid)
               order by m.joined_at, m.id
               limit ${page.limit}`;
      return rows.map(toMembershipView);
    },

    findActiveForUser: async (executor, userId, organisationId) => {
      const rows = await executor`
        ${membershipViewSelect(executor)}
         where m.user_id = ${userId}
           and m.organisation_id = ${organisationId}
           and m.membership_status = 'active'
         limit 1`;
      return rows.length === 0 ? null : toMembershipView(rows[0]);
    },
  };
}

export function createPostgresRoleTemplateRepository(): RoleTemplateRepository {
  return {
    findActiveRoleIdByCode: async (tx, code) => {
      const rows = await tx.sql`
        select r.id
          from permissions.roles r
         where r.code = ${code}
           and r.status = 'active'
         limit 1`;
      const parsed = IdRowSchema.safeParse(rows[0]);
      return rows.length === 0 || !parsed.success ? null : parsed.data.id;
    },
  };
}

const CreationRequestRowSchema = z.object({
  request_hash: z.string(),
  organisation_id: OrganisationIdSchema,
  tenant_id: TenantIdSchema,
});

export function createPostgresCreationRequestStore(): OrganisationCreationRequestStore {
  return {
    lock: async (tx, userId, idempotencyKeyHash) => {
      // Transaction-scoped advisory lock keyed on (person, key): a concurrent
      // retry waits here until the first attempt commits or rolls back, then
      // sees its record (or its absence) rather than racing it.
      await tx.sql`
        select pg_advisory_xact_lock(hashtext(${userId}::text), hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.organisation_id, r.tenant_id
          from identity.organisation_creation_requests r
         where r.user_id = ${userId}
           and r.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = CreationRequestRowSchema.parse(rows[0]);
      const record: CreationRequestRecord = {
        requestHash: parsed.request_hash,
        organisationId: parsed.organisation_id,
        tenantId: parsed.tenant_id,
      };
      return record;
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into identity.organisation_creation_requests
          (user_id, idempotency_key_hash, request_hash, organisation_id, tenant_id)
        values (${input.userId}, ${input.idempotencyKeyHash}, ${input.requestHash},
                ${input.organisationId}, ${input.tenantId})`;
    },
  };
}

export function createPostgresOrganisationQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): OrganisationQueryPort {
  const { sql } = options;
  return {
    getActiveOrganisationIdentity: async (tenantId, organisationId) => {
      const rows = await sql`
        select o.id, o.tenant_id, o.organisation_type, o.display_name,
               o.website_url, o.country_code, o.status
          from identity.organisations o
         where o.id = ${organisationId}
           and o.tenant_id = ${tenantId}
           and o.status = 'active'`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = OrganisationRowSchema.pick({
        id: true,
        tenant_id: true,
        organisation_type: true,
        display_name: true,
        website_url: true,
        country_code: true,
        status: true,
      }).parse(rows[0]);
      const identity: OrganisationIdentity = {
        id: parsed.id,
        tenantId: parsed.tenant_id,
        organisationType: parsed.organisation_type,
        displayName: parsed.display_name,
        websiteUrl: parsed.website_url,
        countryCode: parsed.country_code,
        status: parsed.status,
      };
      return identity;
    },
  };
}
