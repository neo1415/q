import { z } from "zod";

import {
  RelationshipViewQuerySchema,
  PipelineColumnsSchema,
  RelationshipViewScopeSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

/**
 * network.relationship_views (migration 20261226200000): CRM saved views.
 * SQL only; who may read or write which row is decided by the caller
 * (application/relationship-views.ts) and repeated here in every WHERE,
 * so a row outside the actor's own party and scope is never touched.
 */

export const RelationshipViewDefinitionSchema = z
  .object({
    query: RelationshipViewQuerySchema,
    layout: z.enum(["table", "board"]),
    columns: PipelineColumnsSchema,
  })
  .strict();
export type RelationshipViewDefinition = z.infer<
  typeof RelationshipViewDefinitionSchema
>;

const RowSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  scope: RelationshipViewScopeSchema,
  definition: RelationshipViewDefinitionSchema,
  version: z.number().int().positive(),
  updated_at: z.union([z.date(), z.string()]),
  owner_user_id: UuidSchema,
});
export type RelationshipViewRow = z.infer<typeof RowSchema>;

/** The workspace side a view belongs to: exactly one canonical party. */
export type RelationshipViewParty = {
  readonly tenantId: string;
  readonly organisationId: string;
  readonly companyId: string | null;
  readonly investorOrganisationId: string | null;
};

const rows = (raw: readonly unknown[]) =>
  raw.map((row) => RowSchema.parse(row));

export function createPostgresRelationshipViews() {
  return {
    /** The actor's own personal views and the workspace's shared ones. */
    async list(
      sql: DatabaseExecutor,
      party: RelationshipViewParty,
      userId: string,
      limit: number,
    ): Promise<readonly RelationshipViewRow[]> {
      return rows(
        await sql`
          select id, name, scope, definition, version, updated_at, owner_user_id
            from network.relationship_views
           where tenant_id = ${party.tenantId}
             and organisation_id = ${party.organisationId}
             and company_id is not distinct from ${party.companyId}
             and investor_organisation_id is not distinct from ${party.investorOrganisationId}
             and (scope = 'ORGANISATION' or owner_user_id = ${userId})
           order by scope desc, lower(name), id
           limit ${limit}`,
      );
    },

    async count(
      sql: DatabaseExecutor,
      party: RelationshipViewParty,
      scope: "PERSONAL" | "ORGANISATION",
      userId: string,
    ): Promise<number> {
      const [row] = await sql`
        select count(*)::int as count
          from network.relationship_views
         where tenant_id = ${party.tenantId}
           and organisation_id = ${party.organisationId}
           and company_id is not distinct from ${party.companyId}
           and investor_organisation_id is not distinct from ${party.investorOrganisationId}
           and scope = ${scope}
           and (scope = 'ORGANISATION' or owner_user_id = ${userId})`;
      return z.object({ count: z.number().int() }).parse(row).count;
    },

    /** Null when the id is already taken (a retry, or someone else's). */
    async insert(
      sql: DatabaseExecutor,
      input: {
        readonly id: string;
        readonly party: RelationshipViewParty;
        readonly userId: string;
        readonly membershipId: string;
        readonly name: string;
        readonly scope: "PERSONAL" | "ORGANISATION";
        readonly definition: RelationshipViewDefinition;
      },
    ): Promise<RelationshipViewRow | null> {
      const [row] = await sql`
        insert into network.relationship_views
          (id, tenant_id, organisation_id, company_id, investor_organisation_id,
           owner_user_id, owner_membership_id, name, scope, definition)
        values
          (${input.id}, ${input.party.tenantId}, ${input.party.organisationId},
           ${input.party.companyId}, ${input.party.investorOrganisationId},
           ${input.userId}, ${input.membershipId}, ${input.name}, ${input.scope},
           ${sql.json(input.definition)})
        on conflict (id) do nothing
        returning id, name, scope, definition, version, updated_at, owner_user_id`;
      return row === undefined ? null : RowSchema.parse(row);
    },

    /** One view the actor created in this party, for an idempotent retry. */
    async findOwn(
      sql: DatabaseExecutor,
      id: string,
      party: RelationshipViewParty,
      userId: string,
    ): Promise<RelationshipViewRow | null> {
      const [row] = await sql`
        select id, name, scope, definition, version, updated_at, owner_user_id
          from network.relationship_views
         where id = ${id}
           and tenant_id = ${party.tenantId}
           and organisation_id = ${party.organisationId}
           and company_id is not distinct from ${party.companyId}
           and investor_organisation_id is not distinct from ${party.investorOrganisationId}
           and owner_user_id = ${userId}`;
      return row === undefined ? null : RowSchema.parse(row);
    },

    /** Compare-and-swap: null when the version moved or it isn't theirs. */
    async update(
      sql: DatabaseExecutor,
      input: {
        readonly id: string;
        readonly party: RelationshipViewParty;
        readonly userId: string;
        readonly teamEditable: boolean;
        readonly scope: "PERSONAL" | "ORGANISATION";
        readonly name: string;
        readonly definition: RelationshipViewDefinition;
        readonly expectedVersion: number;
      },
    ): Promise<RelationshipViewRow | null> {
      const [row] = await sql`
        update network.relationship_views
           set name = ${input.name},
               definition = ${sql.json(input.definition)},
               version = version + 1,
               updated_at = now()
         where id = ${input.id}
           and tenant_id = ${input.party.tenantId}
           and organisation_id = ${input.party.organisationId}
           and company_id is not distinct from ${input.party.companyId}
           and investor_organisation_id is not distinct from ${input.party.investorOrganisationId}
           and scope = ${input.scope}
           and version = ${input.expectedVersion}
           and ((scope = 'PERSONAL' and owner_user_id = ${input.userId})
                or (scope = 'ORGANISATION' and ${input.teamEditable}))
        returning id, name, scope, definition, version, updated_at, owner_user_id`;
      return row === undefined ? null : RowSchema.parse(row);
    },

    async remove(
      sql: DatabaseExecutor,
      input: {
        readonly id: string;
        readonly party: RelationshipViewParty;
        readonly userId: string;
        readonly teamEditable: boolean;
        readonly expectedVersion: number;
      },
    ): Promise<boolean> {
      const deleted = await sql`
        delete from network.relationship_views
         where id = ${input.id}
           and tenant_id = ${input.party.tenantId}
           and organisation_id = ${input.party.organisationId}
           and company_id is not distinct from ${input.party.companyId}
           and investor_organisation_id is not distinct from ${input.party.investorOrganisationId}
           and version = ${input.expectedVersion}
           and ((scope = 'PERSONAL' and owner_user_id = ${input.userId})
                or (scope = 'ORGANISATION' and ${input.teamEditable}))
        returning id`;
      return deleted.length === 1;
    },
  };
}
export type RelationshipViewRepository = ReturnType<
  typeof createPostgresRelationshipViews
>;
