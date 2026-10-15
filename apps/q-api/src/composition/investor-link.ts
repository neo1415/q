import type { DatabaseExecutor } from "@capital-q/database";

/**
 * R5: which prepared research record stands in for a canonical investor
 * organisation that is still UNCLAIMED (a public profile built by Q from
 * public sources; not on Capital Q). "Unclaimed" is the platform's existing
 * meaning: the organisation has no active membership. The moment anyone
 * claims it the link stops applying and the real investor is rehearsed from
 * the real investor path, never the simulation.
 *
 * This only maps ids. Whether a person may see the investor at all is the
 * Discover visibility rule, applied by the rehearsal service.
 */
export function createInvestorLink(
  sql: DatabaseExecutor,
): (investorOrganisationId: string) => Promise<string | null> {
  return async (investorOrganisationId) => {
    const rows = await sql<{ id: string }[]>`
      select p.id
        from q_runtime.external_persons p
        join core.investor_organisations i on i.id = p.investor_organisation_id
       where p.investor_organisation_id = ${investorOrganisationId}::uuid
         and p.research_status = 'PREPARED_PUBLIC_SEED'
         and p.tenant_id is null
         and not exists (
           select 1 from identity.organisation_memberships m
            where m.organisation_id = i.organisation_id
              and m.membership_status = 'active')
       limit 1`;
    return rows[0]?.id ?? null;
  };
}
