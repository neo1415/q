import { z } from "zod";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  FeatureValueSchema,
  RecommendationFeatureSnapshotSchema,
  type RecommendationFeatureSnapshot,
} from "../features/contracts.js";
import type {
  FeatureSnapshotStore,
  StoredFeatureSnapshotRef,
} from "../features/ports.js";

/**
 * `recommendation.feature_snapshots` behind the store port. Rows are
 * written by the feature service only; the payload is validated against
 * the application contract before it is bound, and read back through the
 * same schema. Two statements per batch (read current, insert), plus one
 * supersession when something changed — never one per candidate.
 */

const RefRowSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_tenant_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

export function createPostgresFeatureSnapshotStore(options: {
  readonly sql: DatabaseExecutor;
}): FeatureSnapshotStore {
  const { sql } = options;
  return {
    currentFor: async (input) => {
      if (input.companyIds.length === 0) return new Map();
      const rows = await sql`
        select s.id, s.company_id, s.company_tenant_id, s.fingerprint
          from recommendation.feature_snapshots s
         where s.tenant_id = ${input.tenantId}
           and s.investor_organisation_id = ${input.investorOrganisationId}
           and s.mandate_id = ${input.mandateId}
           and s.mode = ${input.mode}
           and s.feature_schema_version = ${input.featureSchemaVersion}
           and s.status = 'CURRENT'
           and s.company_id = any(${[...input.companyIds]}::uuid[])`;
      const out = new Map<string, StoredFeatureSnapshotRef>();
      for (const row of rows) {
        const r = RefRowSchema.parse(row);
        out.set(r.company_id, {
          id: r.id,
          companyTenantId: r.company_tenant_id,
          fingerprint: r.fingerprint,
        });
      }
      return out;
    },

    supersede: async (ids) => {
      if (ids.length === 0) return;
      await sql`
        update recommendation.feature_snapshots
           set status = 'SUPERSEDED', superseded_at = now()
         where id = any(${[...ids]}::uuid[]) and status = 'CURRENT'`;
    },

    insertMany: async (snapshots) => {
      if (snapshots.length === 0) return [];
      const refs: StoredFeatureSnapshotRef[] = [];
      for (const raw of snapshots) {
        // Validated again at the boundary: what is bound is the contract.
        const s = RecommendationFeatureSnapshotSchema.parse(raw);
        const features = s.features.map((f) => FeatureValueSchema.parse(f));
        const rows = await sql`
          insert into recommendation.feature_snapshots
            (tenant_id, investor_organisation_id, mandate_id, mandate_version,
             company_id, company_tenant_id, company_projection_version, mode,
             feature_schema_version, eligibility_policy_version, eligibility_decision,
             structured_generator_version, semantic_generator_version, taxonomy_version,
             candidate_provenance, sensitivity, features, fingerprint, computed_at)
          values
            (${s.context.tenantId}, ${s.context.investorOrganisationId}, ${s.mandateId}, ${s.mandateVersion},
             ${s.companyId}, ${s.companyTenantId}, ${s.companyProjectionVersion}, ${s.context.mode},
             ${s.featureSchemaVersion}, ${s.eligibilityPolicyVersion}, ${s.eligibilityDecision},
             ${s.candidateProvenance.structured?.generatorVersion ?? null},
             ${s.candidateProvenance.semantic?.generatorVersion ?? null},
             ${s.context.taxonomyVersion === null ? null : sql.json(s.context.taxonomyVersion)},
             ${sql.json(s.candidateProvenance)}, ${s.sensitivity}, ${sql.json(features)}, ${s.fingerprint},
             ${s.computedAt}::text::timestamptz)
          returning id, company_id, company_tenant_id, fingerprint`;
        const [first] = rows;
        if (first === undefined)
          throw new Error("feature snapshot insert returned no row");
        const r = RefRowSchema.parse(first);
        refs.push({
          id: r.id,
          companyTenantId: r.company_tenant_id,
          fingerprint: r.fingerprint,
        });
      }
      return refs;
    },
  };
}

/** Reads one CURRENT snapshot back through the contract; for tests and diagnostics. */
export async function readCurrentFeatureSnapshot(
  sql: DatabaseExecutor,
  input: {
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly companyId: string;
    readonly mode: string;
  },
): Promise<RecommendationFeatureSnapshot | null> {
  const rows = await sql`
    select s.tenant_id, s.investor_organisation_id, s.mandate_id, s.mandate_version, s.company_id,
           s.company_tenant_id, s.company_projection_version, s.mode, s.feature_schema_version,
           s.eligibility_policy_version, s.eligibility_decision, s.structured_generator_version,
           s.semantic_generator_version, s.taxonomy_version, s.candidate_provenance, s.sensitivity,
           s.features, s.fingerprint, s.computed_at
      from recommendation.feature_snapshots s
     where s.investor_organisation_id = ${input.investorOrganisationId}
       and s.mandate_id = ${input.mandateId}
       and s.company_id = ${input.companyId}
       and s.mode = ${input.mode}
       and s.status = 'CURRENT'`;
  const [row] = rows;
  if (row === undefined) return null;
  const r = z
    .object({
      tenant_id: z.string().uuid(),
      investor_organisation_id: z.string().uuid(),
      mandate_id: z.string().uuid(),
      mandate_version: z.number().int(),
      company_id: z.string().uuid(),
      company_tenant_id: z.string().uuid(),
      company_projection_version: z.number().int(),
      mode: z.string(),
      feature_schema_version: z.string(),
      eligibility_policy_version: z.string(),
      eligibility_decision: z.string(),
      structured_generator_version: z.string().nullable(),
      semantic_generator_version: z.string().nullable(),
      taxonomy_version: z.record(z.string(), z.number().int()).nullable(),
      candidate_provenance: z.unknown(),
      sensitivity: z.string(),
      features: z.array(z.unknown()),
      fingerprint: z.string(),
      computed_at: z.union([z.string(), z.date()]),
    })
    .parse(row);
  return RecommendationFeatureSnapshotSchema.parse({
    featureSchemaVersion: r.feature_schema_version,
    context: {
      tenantId: r.tenant_id,
      investorOrganisationId: r.investor_organisation_id,
      mode: r.mode,
      mandateId: r.mandate_id,
      taxonomyVersion: r.taxonomy_version,
      eligibilityPolicyVersion: r.eligibility_policy_version,
    },
    mandateId: r.mandate_id,
    mandateVersion: r.mandate_version,
    companyId: r.company_id,
    companyTenantId: r.company_tenant_id,
    companyProjectionVersion: r.company_projection_version,
    eligibilityPolicyVersion: r.eligibility_policy_version,
    eligibilityDecision: r.eligibility_decision,
    candidateProvenance: r.candidate_provenance,
    sensitivity: r.sensitivity,
    features: r.features,
    fingerprint: r.fingerprint,
    computedAt:
      r.computed_at instanceof Date
        ? r.computed_at.toISOString()
        : r.computed_at,
  });
}
