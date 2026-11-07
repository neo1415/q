import type { DatabaseExecutor } from "@capital-q/database";

import type { SuitabilityRecord } from "../fit/order.js";

/**
 * The two score projections, as discovery reads and writes them
 * (migration 20261228171500).
 *
 *   investability  read-only here: each company's latest SCORED,
 *                  non-provisional Investability (0-100) under the current
 *                  method version. The projection is written by the
 *                  readiness package from investor-eligible inputs only, so
 *                  reading it cannot carry founder-private material into an
 *                  order. Unknown (no row, insufficient evidence) is absent.
 *   suitability    the fit each candidate was ordered with, per investor
 *                  organisation and mandate; investor-private.
 */

export function createPostgresInvestabilityScores(options: {
  readonly sql: DatabaseExecutor;
  /**
   * The current Investability method. Only its latest revision is read:
   * method versions are never mixed in one order (metrics audit P1-1).
   */
  readonly methodVersion: string;
}): (companyIds: readonly string[]) => Promise<ReadonlyMap<string, number>> {
  return async (companyIds) => {
    const ids = [...new Set(companyIds)];
    if (ids.length === 0) return new Map();
    const rows = await options.sql<
      {
        company_id: string;
        status: string;
        score: number | null;
        provisional: string | null;
      }[]
    >`
      select distinct on (company_id) company_id, status, score,
             summary->>'provisional' as provisional
        from core.company_investability_assessments
       where company_id = any(${ids}::uuid[])
         and method_version = ${options.methodVersion}
       order by company_id, revision desc`;
    const out = new Map<string, number>();
    for (const row of rows) {
      // An early read (ADR 0075) may rest on Q's unconfirmed reading of a
      // deck: shown with Low confidence, never an ordering input (metrics
      // audit P0-3; no model output in the ranking path). Absent = unknown.
      if (
        row.status === "SCORED" &&
        row.score !== null &&
        row.provisional !== "true"
      ) {
        out.set(row.company_id, Number(row.score));
      }
    }
    return out;
  };
}

export function createPostgresSuitabilityRecorder(options: {
  readonly sql: DatabaseExecutor;
}): (rows: readonly SuitabilityRecord[]) => Promise<void> {
  const { sql } = options;
  return async (rows) => {
    for (const row of rows) {
      const s = row.suitability;
      await sql`
        insert into core.investor_company_suitability
          (tenant_id, investor_organisation_id, organisation_id, mandate_id, company_id,
           fit_config_version, status, score, known, applicable, summary, computed_at)
        values (${row.tenantId}::uuid, ${row.investorOrganisationId}::uuid,
                ${row.organisationId}::uuid, ${row.mandateId}::uuid, ${row.companyId}::uuid,
                ${s.configVersion}, ${s.status}, ${s.score}, ${s.coverage.known},
                ${s.coverage.applicable}, ${sql.json(s)}, ${row.computedAt}::timestamptz)
        on conflict (investor_organisation_id, mandate_id, company_id) do update
          set fit_config_version = excluded.fit_config_version,
              status = excluded.status,
              score = excluded.score,
              known = excluded.known,
              applicable = excluded.applicable,
              summary = excluded.summary,
              computed_at = excluded.computed_at
        where core.investor_company_suitability.summary is distinct from excluded.summary`;
    }
  };
}
