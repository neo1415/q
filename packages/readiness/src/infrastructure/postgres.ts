import type { DatabaseExecutor } from "@capital-q/database";

import type { ReadinessClaimInput, ReadinessInputs } from "../domain/inputs.js";

/**
 * Readiness storage and its read projection (20261216090000).
 *
 * The profile facts are read here, for ONE company the service already
 * resolved as the actor's own, read-only, the way the Results reader does
 * (`@capital-q/results`): the company's description and stage, its team
 * facts, its founders' background lines, its verification state, its
 * confirmed categories and its own claims. Nothing here is written to any
 * of those tables, and nothing here is read for anyone but the company's
 * own members.
 *
 * Assessments are append-only revisions: a new row only when the basis
 * (rules version + inputs) changes. Action marks are append-only events;
 * the latest per action is its state.
 */

type LiveLifecycle = ReadinessClaimInput["lifecycleStatus"];

export type ReadinessProfileFacts = Pick<
  ReadinessInputs,
  "stageCode" | "profile" | "team" | "verification" | "claims"
> & { readonly tenantId: string };

export type ReadinessStore = {
  readonly profileFacts: (
    companyId: string,
  ) => Promise<ReadinessProfileFacts | null>;
  readonly latest: (companyId: string) => Promise<{
    readonly revision: number;
    readonly basisHash: string;
    readonly assessedAt: string;
  } | null>;
  /** Appends the next revision unless the latest has this basis; returns the current one. */
  readonly record: (input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly rulesVersion: string;
    readonly basisHash: string;
    readonly assessment: unknown;
  }) => Promise<{ readonly revision: number; readonly assessedAt: string }>;
  readonly marks: (
    companyId: string,
  ) => Promise<
    ReadonlyMap<string, { readonly done: boolean; readonly at: string }>
  >;
  readonly mark: (input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly actionKey: string;
    readonly done: boolean;
    readonly userId: string;
    readonly rulesVersion: string;
  }) => Promise<void>;
};

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

export function createPostgresReadinessStore(options: {
  readonly sql: DatabaseExecutor;
}): ReadinessStore {
  const { sql } = options;

  return {
    profileFacts: async (companyId) => {
      const [company] = await sql<
        {
          tenant_id: string;
          organisation_id: string;
          current_stage_code: string | null;
          has_description: boolean;
          has_website: boolean;
          founder_count: number | null;
          full_time_founder_count: number | null;
          team_size: number | null;
        }[]
      >`
        select c.tenant_id, c.organisation_id, c.current_stage_code,
               (coalesce(btrim(c.primary_description), '') <> ''
                 or coalesce(btrim(c.short_description), '') <> '') as has_description,
               coalesce(btrim(c.website_url), '') <> '' as has_website,
               t.founder_count, t.full_time_founder_count, t.team_size
          from core.companies c
          left join core.company_team_facts t
            on t.company_id = c.id and t.tenant_id = c.tenant_id
         where c.id = ${companyId}::uuid`;
      if (company === undefined) return null;
      const [counts] = await sql<
        {
          backgrounds: number;
          categories: number;
          verified_founders: number;
          organisation_verified: boolean;
          domain_verified: boolean;
        }[]
      >`
        with current_claims as (
          select distinct on (v.claim_type, v.subject_key) v.claim_type, v.status,
                 v.revoked_at, v.expires_at
            from evidence.verification_claims v
           where v.organisation_id = ${company.organisation_id}::uuid
             and v.tenant_id = ${company.tenant_id}::uuid
           order by v.claim_type, v.subject_key, v.revision desc
        ), live as (
          select claim_type from current_claims
           where status = 'VERIFIED' and revoked_at is null
             and (expires_at is null or expires_at > now())
        )
        select
          (select count(*)::int
             from core.founder_background_entries b
             join core.company_members m
               on m.user_id = b.user_id and m.tenant_id = b.tenant_id
            where m.company_id = ${companyId}::uuid
              and m.is_founder and m.is_current) as backgrounds,
          (select count(*)::int
             from taxonomy.entity_assignments a
            where a.entity_type = 'COMPANY'
              and a.entity_id = ${companyId}::uuid
              and a.status = 'ACTIVE'
              and a.valid_to is null
              and (a.assignment_source in ('user_selected', 'admin_curated')
                   or a.confirmed_at is not null)) as categories,
          (select count(*)::int from live where claim_type = 'FOUNDER_IDENTITY') as verified_founders,
          exists (select 1 from live where claim_type = 'ORGANISATION') as organisation_verified,
          exists (select 1 from live where claim_type = 'DOMAIN_CONTROL') as domain_verified`;
      const claims = await sql<
        {
          id: string;
          claim_type: string;
          claim_key: string;
          statement: string;
          truth_class: ReadinessClaimInput["truthClass"];
          evidence_status: ReadinessClaimInput["evidenceStatus"];
          lifecycle_status: LiveLifecycle;
        }[]
      >`
        select id, claim_type, claim_key, statement, truth_class,
               evidence_status, lifecycle_status
          from evidence.claims
         where tenant_id = ${company.tenant_id}::uuid
           and subject_type = 'COMPANY'
           and subject_id = ${companyId}::uuid
           and lifecycle_status in ('CURRENT', 'DISPUTED', 'CONTRADICTORY', 'STALE')
         order by claim_key, created_at
         limit 200`;
      return {
        tenantId: company.tenant_id,
        stageCode: company.current_stage_code,
        profile: {
          description: company.has_description,
          website: company.has_website,
          categories: counts?.categories ?? 0,
        },
        team: {
          founderCount: company.founder_count,
          fullTimeFounderCount: company.full_time_founder_count,
          teamSize: company.team_size,
          founderBackgrounds: counts?.backgrounds ?? 0,
          verifiedFounderIdentities: counts?.verified_founders ?? 0,
        },
        verification: {
          organisation: counts?.organisation_verified ?? false,
          domain: counts?.domain_verified ?? false,
        },
        claims: claims.map((row) => ({
          id: row.id,
          claimType: row.claim_type,
          claimKey: row.claim_key,
          statement: row.statement,
          truthClass: row.truth_class,
          evidenceStatus: row.evidence_status,
          lifecycleStatus: row.lifecycle_status,
        })),
      };
    },

    latest: async (companyId) => {
      const [row] = await sql<
        { revision: number; basis_hash: string; assessed_at: Date }[]
      >`
        select revision, basis_hash, assessed_at
          from core.company_readiness_assessments
         where company_id = ${companyId}::uuid
         order by revision desc
         limit 1`;
      return row === undefined
        ? null
        : {
            revision: row.revision,
            basisHash: row.basis_hash,
            assessedAt: iso(row.assessed_at),
          };
    },

    record: async (input) => {
      // The next revision only when the basis moved; a concurrent writer
      // of the same revision loses quietly and the winner is read back.
      await sql`
        insert into core.company_readiness_assessments
          (tenant_id, company_id, revision, rules_version, basis_hash, assessment)
        select ${input.tenantId}::uuid, ${input.companyId}::uuid,
               coalesce(max(a.revision), 0) + 1, ${input.rulesVersion},
               ${input.basisHash}, ${sql.json(input.assessment as never)}
          from core.company_readiness_assessments a
         where a.company_id = ${input.companyId}::uuid
        having coalesce((array_agg(a.basis_hash order by a.revision desc))[1], '') <> ${input.basisHash}
        on conflict (company_id, revision) do nothing`;
      const [row] = await sql<{ revision: number; assessed_at: Date }[]>`
        select revision, assessed_at
          from core.company_readiness_assessments
         where company_id = ${input.companyId}::uuid
         order by revision desc
         limit 1`;
      return row === undefined
        ? { revision: 1, assessedAt: new Date().toISOString() }
        : { revision: row.revision, assessedAt: iso(row.assessed_at) };
    },

    marks: async (companyId) => {
      const rows = await sql<
        { action_key: string; event: string; occurred_at: Date }[]
      >`
        select distinct on (action_key) action_key, event, occurred_at
          from core.company_readiness_action_events
         where company_id = ${companyId}::uuid
         order by action_key, occurred_at desc, id desc`;
      return new Map(
        rows.map((row) => [
          row.action_key,
          { done: row.event === "MARKED_DONE", at: iso(row.occurred_at) },
        ]),
      );
    },

    mark: async (input) => {
      await sql`
        insert into core.company_readiness_action_events
          (tenant_id, company_id, action_key, event, actor_user_id, rules_version)
        values (${input.tenantId}::uuid, ${input.companyId}::uuid, ${input.actionKey},
                ${input.done ? "MARKED_DONE" : "REOPENED"}, ${input.userId}::uuid,
                ${input.rulesVersion})`;
    },
  };
}
