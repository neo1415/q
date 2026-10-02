import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  projectTeamForNetwork,
  type TeamProjectionSource,
} from "../domain/team-projection.js";

const Row = z.object({
  display_name: z.string().nullable(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  relationship_type: z.enum([
    "team_member",
    "advisor",
    "board_member",
    "contractor",
    "other",
  ]),
  business_title: z.string().nullable(),
  is_founder: z.boolean(),
  professional_summary: z.string().nullable(),
});

/**
 * A company's current team, read for the investor projection (ADR 0041).
 * Server-side, tenant-matched, current members only, founders first. The
 * query selects only the projection's inputs: no email, no user id, no
 * background summary, no visibility label. Who may see the result is the
 * caller's decision, made before this is asked.
 */
export function createPostgresCompanyTeamProjection(options: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    teamForNetwork: async (company: {
      readonly tenantId: string;
      readonly companyId: string;
    }) => {
      const rows = await options.sql`
        select p.display_name, p.given_name, p.family_name,
               m.relationship_type, m.business_title, m.is_founder,
               f.professional_summary
          from core.company_members m
          join identity.user_profiles p on p.id = m.user_id
          left join core.founder_profiles f
            on f.tenant_id = m.tenant_id and f.user_id = m.user_id
         where m.tenant_id = ${company.tenantId}
           and m.company_id = ${company.companyId}
           and m.is_current
         order by m.is_founder desc, m.started_at asc, m.id asc
         limit 50`;
      const sources: TeamProjectionSource[] = rows.map((raw) => {
        const row = Row.parse(raw);
        return {
          displayName: row.display_name,
          givenName: row.given_name,
          familyName: row.family_name,
          relationshipType: row.relationship_type,
          businessTitle: row.business_title,
          isFounder: row.is_founder,
          professionalSummary: row.professional_summary,
        };
      });
      return projectTeamForNetwork(sources);
    },
  };
}
