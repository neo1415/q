import {
  InvestabilityDtoSchema,
  type InvestabilityDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type {
  InvestabilityClaimInput,
  InvestabilityFounderLine,
  InvestabilityInputs,
} from "./inputs.js";

/**
 * Investability storage (migration 20261228151000) and its investor-
 * eligible input reader.
 *
 * The reader is the Context Firewall's DB layer for this score: every
 * query names its eligibility in the WHERE clause, so founder-private rows
 * are never fetched at all (not fetched-then-filtered):
 *   profile       knowledge.company_profiles, the network-visible projection
 *                 (listed companies only; never the capital objective)
 *   founders      core.founder_background_entries with
 *                 visibility_scope = 'network_visible'
 *   claims        evidence.claims scoped network_visible / public_external
 * The deck (offered to all investors, confirmed sections only) arrives
 * through an injected port from the composition root.
 *
 * Assessments are append-only revisions, a new row only when the basis
 * hash changes (method + input rules + observations).
 */

export type InvestabilityDeckPort = (
  companyId: string,
) => Promise<InvestabilityInputs["deck"]>;

export type InvestabilitySubject = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly organisationId: string;
};

export type InvestabilityStore = {
  /** Null: the company does not exist. Unlisted companies read as listed=false. */
  readonly inputs: (companyId: string) => Promise<{
    readonly subject: InvestabilitySubject;
    readonly inputs: Omit<InvestabilityInputs, "deck">;
  } | null>;
  /** Companies listed to the network now, for the sweep and the backfill. */
  readonly listedCompanyIds: (limit: number) => Promise<readonly string[]>;
  readonly latest: (
    companyId: string,
    methodVersion: string,
  ) => Promise<{
    readonly revision: number;
    readonly basisHash: string;
  } | null>;
  readonly record: (input: {
    readonly subject: InvestabilitySubject;
    readonly methodVersion: string;
    readonly basisHash: string;
    readonly view: Omit<InvestabilityDto, "assessedAt">;
    readonly assessment: unknown;
  }) => Promise<{ readonly revision: number; readonly created: boolean }>;
  /** The latest view per company under this method version. */
  readonly current: (
    companyIds: readonly string[],
    methodVersion: string,
  ) => Promise<ReadonlyMap<string, InvestabilityDto>>;
};

const iso = (value: Date | string | null | undefined): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

export function createPostgresInvestabilityStore(options: {
  readonly sql: DatabaseExecutor;
}): InvestabilityStore {
  const { sql } = options;

  return {
    inputs: async (companyId) => {
      const [company] = await sql<
        {
          id: string;
          tenant_id: string;
          organisation_id: string;
          listed: boolean | null;
          stage_code: string | null;
          sector_codes: string[] | null;
          business_model_codes: string[] | null;
          has_description: boolean | null;
          has_website: boolean | null;
          verified: boolean | null;
          profile_updated_at: Date | null;
        }[]
      >`
        select c.id, c.tenant_id, c.organisation_id,
               (p.listed and c.company_status = 'active') as listed,
               p.stage_code, p.sector_codes, p.business_model_codes,
               (coalesce(btrim(p.primary_description), '') <> ''
                 or coalesce(btrim(p.short_description), '') <> '') as has_description,
               coalesce(btrim(p.website_url), '') <> '' as has_website,
               p.verification_status = 'VERIFIED' as verified,
               p.updated_at as profile_updated_at
          from core.companies c
          left join knowledge.company_profiles p on p.company_id = c.id
         where c.id = ${companyId}::uuid`;
      if (company === undefined) return null;
      const subject: InvestabilitySubject = {
        companyId: company.id,
        tenantId: company.tenant_id,
        organisationId: company.organisation_id,
      };
      const listed = company.listed === true;
      if (!listed) {
        return {
          subject,
          inputs: {
            companyId: company.id,
            stageCode: null,
            sectorCodes: [],
            businessModelCodes: [],
            profile: {
              listed: false,
              description: false,
              website: false,
              updatedAt: null,
            },
            verification: {
              organisation: false,
              domain: false,
              decidedAt: null,
            },
            founders: [],
            claims: [],
          },
        };
      }
      const [founders, claims] = await Promise.all([
        sql<
          {
            id: string;
            title: string;
            detail: string | null;
            supported: boolean;
            visibility_scope: string;
          }[]
        >`
          select b.id, b.title, b.detail,
                 b.supporting_document_id is not null as supported,
                 b.visibility_scope
            from core.founder_background_entries b
            join core.company_members m
              on m.user_id = b.user_id and m.tenant_id = b.tenant_id
           where m.company_id = ${companyId}::uuid
             and m.is_founder and m.is_current
             and b.visibility_scope = 'network_visible'
           order by b.id
           limit 50`,
        sql<
          {
            id: string;
            claim_type: string;
            claim_key: string;
            statement: string;
            truth_class: InvestabilityClaimInput["truthClass"];
            evidence_status: InvestabilityClaimInput["evidenceStatus"];
            lifecycle_status: InvestabilityClaimInput["lifecycleStatus"];
            visibility_scope: string;
            asserted_at: Date;
          }[]
        >`
          select id, claim_type, claim_key, statement, truth_class,
                 evidence_status, lifecycle_status, visibility_scope, asserted_at
            from evidence.claims
           where tenant_id = ${company.tenant_id}::uuid
             and subject_type = 'COMPANY'
             and subject_id = ${companyId}::uuid
             and visibility_scope in ('network_visible', 'public_external')
             and lifecycle_status <> 'SUPERSEDED'
           order by claim_key, id
           limit 200`,
      ]);
      return {
        subject,
        inputs: {
          companyId: company.id,
          stageCode: company.stage_code,
          sectorCodes: company.sector_codes ?? [],
          businessModelCodes: company.business_model_codes ?? [],
          profile: {
            listed: true,
            description: company.has_description === true,
            website: company.has_website === true,
            updatedAt: iso(company.profile_updated_at),
          },
          verification: {
            organisation: company.verified === true,
            domain: false,
            decidedAt: null,
          },
          founders: founders.map((row): InvestabilityFounderLine => ({
            id: row.id,
            title: row.title,
            detail: row.detail,
            documentSupported: row.supported,
            visibilityScope: row.visibility_scope,
          })),
          claims: claims.map((row): InvestabilityClaimInput => ({
            id: row.id,
            claimType: row.claim_type,
            claimKey: row.claim_key,
            statement: row.statement,
            truthClass: row.truth_class,
            evidenceStatus: row.evidence_status,
            lifecycleStatus: row.lifecycle_status,
            visibilityScope: row.visibility_scope,
            assertedAt: iso(row.asserted_at) ?? new Date(0).toISOString(),
          })),
        },
      };
    },

    listedCompanyIds: async (limit) => {
      const rows = await sql<{ company_id: string }[]>`
        select company_id from knowledge.company_profiles
         where listed
         order by company_id
         limit ${limit}`;
      return rows.map((row) => row.company_id);
    },

    latest: async (companyId, methodVersion) => {
      const [row] = await sql<{ revision: number; basis_hash: string }[]>`
        select revision, basis_hash
          from core.company_investability_assessments
         where company_id = ${companyId}::uuid
           and method_version = ${methodVersion}
         order by revision desc
         limit 1`;
      return row === undefined
        ? null
        : { revision: row.revision, basisHash: row.basis_hash };
    },

    record: async (input) => {
      const view = input.view;
      // The next revision only when the basis moved; a concurrent writer of
      // the same revision loses quietly (idempotent redelivery).
      const inserted = await sql<{ revision: number }[]>`
        insert into core.company_investability_assessments
          (tenant_id, company_id, organisation_id, method_version, revision,
           basis_hash, status, score, band, confidence,
           areas_scored, areas_total, criteria_scored, criteria_applicable,
           summary, assessment)
        select ${input.subject.tenantId}::uuid, ${input.subject.companyId}::uuid,
               ${input.subject.organisationId}::uuid, ${input.methodVersion},
               coalesce(max(a.revision), 0) + 1, ${input.basisHash},
               ${view.status}, ${view.score}, ${view.band}, ${view.confidence},
               ${view.coverage.areasScored}, ${view.coverage.areasTotal},
               ${view.coverage.criteriaScored}, ${view.coverage.criteriaApplicable},
               ${sql.json(view)}, ${sql.json(input.assessment as never)}
          from core.company_investability_assessments a
         where a.company_id = ${input.subject.companyId}::uuid
           and a.method_version = ${input.methodVersion}
        having coalesce((array_agg(a.basis_hash order by a.revision desc))[1], '') <> ${input.basisHash}
        on conflict (company_id, method_version, revision) do nothing
        returning revision`;
      if (inserted[0] !== undefined) {
        return { revision: inserted[0].revision, created: true };
      }
      const [row] = await sql<{ revision: number }[]>`
        select revision from core.company_investability_assessments
         where company_id = ${input.subject.companyId}::uuid
           and method_version = ${input.methodVersion}
         order by revision desc limit 1`;
      return { revision: row?.revision ?? 0, created: false };
    },

    current: async (companyIds, methodVersion) => {
      const ids = [...new Set(companyIds)];
      if (ids.length === 0) return new Map();
      const rows = await sql<
        { company_id: string; summary: unknown; assessed_at: Date }[]
      >`
        select distinct on (company_id) company_id, summary, assessed_at
          from core.company_investability_assessments
         where company_id = any(${ids}::uuid[])
           and method_version = ${methodVersion}
         order by company_id, revision desc`;
      const out = new Map<string, InvestabilityDto>();
      for (const row of rows) {
        const parsed = InvestabilityDtoSchema.safeParse({
          ...(row.summary as Record<string, unknown>),
          assessedAt: iso(row.assessed_at),
        });
        if (parsed.success) out.set(row.company_id, parsed.data);
      }
      return out;
    },
  };
}
