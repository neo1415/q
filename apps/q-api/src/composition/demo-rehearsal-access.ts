import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Demo rehearsal access: "this tenant's founders may rehearse with a
 * researched simulation of this prepared public entity". It is an
 * entitlement to a labelled simulation only, never a relationship,
 * connection, message, meeting, interest or mandate, and it never lets a
 * person read an investor or research row. Revoked grants (revoked_at) and
 * anything that is not a platform-prepared seed never count.
 */

export type DemoRehearsalEntity = {
  readonly externalPersonId: string;
  readonly investorOrganisationId: string | null;
  readonly displayName: string;
  readonly nameVariants: readonly string[];
  readonly entityKind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
};

export type DemoRehearsalAccess = {
  /** Does this tenant hold a live grant for the prepared entity? */
  readonly holds: (
    actor: { readonly tenantId: string },
    externalPersonId: string,
  ) => Promise<boolean>;
  /** Every prepared entity this tenant holds a live grant for. */
  readonly list: (actor: {
    readonly tenantId: string;
  }) => Promise<readonly DemoRehearsalEntity[]>;
};

type Row = {
  id: string;
  investor_organisation_id: string | null;
  display_name: string;
  name_variants: unknown;
  entity_kind: DemoRehearsalEntity["entityKind"];
};

export function createDemoRehearsalAccess(
  sql: DatabaseExecutor,
): DemoRehearsalAccess {
  return {
    holds: async (actor, externalPersonId) => {
      const rows = await sql<{ one: number }[]>`
        select 1 as one
          from q_runtime.demo_rehearsal_access a
          join q_runtime.external_persons p on p.id = a.external_person_id
         where a.tenant_id = ${actor.tenantId}::uuid
           and a.external_person_id = ${externalPersonId}::uuid
           and a.revoked_at is null
           and p.tenant_id is null
           and p.research_status = 'PREPARED_PUBLIC_SEED'
         limit 1`;
      return rows.length > 0;
    },
    list: async (actor) => {
      const rows = await sql<Row[]>`
        select p.id, p.investor_organisation_id, p.display_name,
               p.name_variants, p.entity_kind
          from q_runtime.demo_rehearsal_access a
          join q_runtime.external_persons p on p.id = a.external_person_id
         where a.tenant_id = ${actor.tenantId}::uuid
           and a.revoked_at is null
           and p.tenant_id is null
           and p.research_status = 'PREPARED_PUBLIC_SEED'
         order by p.display_name
         limit 20`;
      return rows.map((row) => ({
        externalPersonId: row.id,
        investorOrganisationId: row.investor_organisation_id,
        displayName: row.display_name,
        nameVariants: Array.isArray(row.name_variants)
          ? row.name_variants.filter((v): v is string => typeof v === "string")
          : [],
        entityKind: row.entity_kind,
      }));
    },
  };
}
