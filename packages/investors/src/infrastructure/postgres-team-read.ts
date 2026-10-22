import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

const Row = z.object({
  display_name: z.string().nullable(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  business_title: z.string().nullable(),
});

/**
 * An investor organisation's current representatives, by name and title,
 * for its Q Card's team section (Q Story S6). Server-side and
 * permission-neutral: the card's owner decides whether the section shows,
 * and to members only. A person with no name on record is left out rather
 * than shown as blank.
 */
export function createPostgresInvestorTeamRead({
  sql,
}: {
  readonly sql: DatabaseExecutor;
}) {
  return {
    current: async (input: {
      readonly tenantId: string;
      readonly investorOrganisationId: string;
    }): Promise<
      readonly { readonly name: string; readonly role: string | null }[]
    > => {
      const rows = await sql`
        select p.display_name, p.given_name, p.family_name, r.business_title
          from core.investor_representatives r
          join identity.user_profiles p on p.id = r.user_id
         where r.tenant_id = ${input.tenantId}
           and r.investor_organisation_id = ${input.investorOrganisationId}
           and r.is_current
         order by r.started_at asc, r.id asc
         limit 12`;
      return rows.flatMap((raw) => {
        const row = Row.parse(raw);
        const name =
          row.display_name?.trim() ||
          [row.given_name, row.family_name]
            .filter((part) => part !== null && part.trim() !== "")
            .join(" ")
            .trim();
        return name.length === 0
          ? []
          : [{ name, role: row.business_title?.trim() || null }];
      });
    },
  };
}
