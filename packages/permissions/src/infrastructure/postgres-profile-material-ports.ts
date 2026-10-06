import type { DatabaseExecutor } from "@capital-q/database";

import type { DataRoomCompany } from "../application/data-room.js";

/**
 * Small, permission-neutral reads the data-room and deck services need,
 * composed the same way by the API and Q's runtime. None of them decides
 * access: the services do, after reading these.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createPostgresProfileMaterialPorts(options: { readonly sql: DatabaseExecutor }) {
  const { sql } = options;
  return {
    company: async (companyId: string): Promise<DataRoomCompany | null> => {
      if (!UUID.test(companyId)) return null;
      const rows = await sql<
        {
          id: string;
          tenant_id: string;
          organisation_id: string;
          canonical_name: string;
          current_stage_code: string | null;
          headquarters_country: string | null;
        }[]
      >`
        select id, tenant_id, organisation_id, canonical_name, current_stage_code, headquarters_country
          from core.companies where id = ${companyId}`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            id: row.id,
            tenantId: row.tenant_id,
            organisationId: row.organisation_id,
            name: row.canonical_name,
            stageCode: row.current_stage_code,
            countryCode: row.headquarters_country,
          };
    },

    investorName: async (investorOrganisationId: string): Promise<string> => {
      const rows = await sql<{ display_name: string }[]>`
        select display_name from core.investor_organisations where id = ${investorOrganisationId}`;
      return rows[0]?.display_name ?? "Investor";
    },

    personName: async (userId: string): Promise<string | null> => {
      const rows = await sql<{ name: string | null }[]>`
        select nullif(btrim(coalesce(display_name, concat_ws(' ', given_name, family_name))), '') as name
          from identity.user_profiles where id = ${userId}`;
      return rows[0]?.name ?? null;
    },

    /** The canonical relationship of the pair, if it exists (never created here). */
    relationshipOf: async (companyId: string, investorOrganisationId: string): Promise<string | null> => {
      const rows = await sql<{ id: string }[]>`
        select id from network.relationships
         where company_id = ${companyId} and investor_organisation_id = ${investorOrganisationId}`;
      return rows[0]?.id ?? null;
    },
  };
}
