import { z } from "zod";

import {
  TaxonomyMatchTypeSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  TaxonomyCanonicalCodeSchema,
  TaxonomyNodeIdSchema,
  TaxonomySubjectTypeSchema,
  TaxonomyVocabularyCodeSchema,
} from "../../contracts/index.js";
import {
  TaxonomyCandidateConfidenceSchema,
  TaxonomyClassificationRunIdSchema,
  TaxonomyClassificationRunMetadataSchema,
  TaxonomyClassificationRunStatusSchema,
  type TaxonomyClassificationCandidateRecord,
  type TaxonomyClassificationRun,
} from "../contracts/index.js";
import type { TaxonomyClassificationRunRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for classification provenance. Every read is
 * tenant-scoped in SQL; there is no delete. Metadata is validated against
 * the bounded schema on the way in and out, so raw text can never be
 * smuggled into a run through this adapter.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const VersionSet = z.record(
  TaxonomyVocabularyCodeSchema,
  z.number().int().min(1),
);

const RunRow = z.object({
  id: TaxonomyClassificationRunIdSchema,
  tenant_id: TenantIdSchema,
  subject_type: TaxonomySubjectTypeSchema,
  subject_id: UuidSchema,
  input_source_type: z.string().nullable(),
  input_source_id: UuidSchema.nullable(),
  classifier_provider: z.string(),
  classifier_model: z.string(),
  classifier_version: z.string(),
  taxonomy_version: VersionSet,
  status: TaxonomyClassificationRunStatusSchema,
  started_at: Timestamp,
  completed_at: Timestamp.nullable(),
  cost_usd: z.string(),
  metadata: TaxonomyClassificationRunMetadataSchema,
});

function toRun(row: unknown): TaxonomyClassificationRun {
  const r = RunRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    inputSourceType: r.input_source_type,
    inputSourceId: r.input_source_id,
    classifierProvider: r.classifier_provider,
    classifierModel: r.classifier_model,
    classifierVersion: r.classifier_version,
    taxonomyVersion: r.taxonomy_version,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    costUsd: r.cost_usd,
    metadata: r.metadata,
  };
}

const CandidateRow = z.object({
  classification_run_id: TaxonomyClassificationRunIdSchema,
  node_id: TaxonomyNodeIdSchema,
  vocabulary_code: TaxonomyVocabularyCodeSchema,
  canonical_code: TaxonomyCanonicalCodeSchema,
  rank: z.number().int().min(1),
  confidence: TaxonomyCandidateConfidenceSchema,
  match_types: z.array(TaxonomyMatchTypeSchema).min(1),
  rationale_summary: z.string(),
  accepted: z.boolean().nullable(),
  decided_by_user_id: UserIdSchema.nullable(),
  decided_at: Timestamp.nullable(),
});

function toCandidate(row: unknown): TaxonomyClassificationCandidateRecord {
  const r = CandidateRow.parse(row);
  return {
    runId: r.classification_run_id,
    nodeId: r.node_id,
    vocabularyCode: r.vocabulary_code,
    canonicalCode: r.canonical_code,
    rank: r.rank,
    confidence: r.confidence,
    matchTypes: r.match_types,
    rationaleSummary: r.rationale_summary,
    accepted: r.accepted,
    decidedByUserId: r.decided_by_user_id,
    decidedAt: r.decided_at,
  };
}

function runSelect(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.subject_type, r.subject_id, r.input_source_type, r.input_source_id,
           r.classifier_provider, r.classifier_model, r.classifier_version, r.taxonomy_version,
           r.status, r.started_at, r.completed_at, r.cost_usd::text as cost_usd, r.metadata
      from taxonomy.classification_runs r`;
}

export function createPostgresTaxonomyClassificationRunRepository(): TaxonomyClassificationRunRepository {
  return {
    insertRun: async (tx, input) => {
      const metadata = TaxonomyClassificationRunMetadataSchema.parse(
        input.metadata,
      );
      const rows = await tx.sql`
        insert into taxonomy.classification_runs
          (tenant_id, subject_type, subject_id, input_source_type, input_source_id,
           classifier_provider, classifier_model, classifier_version, taxonomy_version, status, metadata)
        values
          (${input.tenantId}, ${input.subjectType}, ${input.subjectId}, ${input.inputSourceType},
           ${input.inputSourceId}, ${input.classifierProvider}, ${input.classifierModel},
           ${input.classifierVersion}, ${JSON.stringify(input.taxonomyVersion)}::text::jsonb, 'RUNNING',
           ${JSON.stringify(metadata)}::text::jsonb)
        returning id`;
      const inserted = z
        .object({ id: TaxonomyClassificationRunIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${runSelect(tx.sql)} where r.id = ${inserted.id}`;
      return toRun(created[0]);
    },
    finishRun: async (tx, input) => {
      const metadata = TaxonomyClassificationRunMetadataSchema.parse(
        input.metadata,
      );
      await tx.sql`
        update taxonomy.classification_runs r
           set status = ${input.status},
               completed_at = clock_timestamp(),
               cost_usd = ${input.costUsd}::text::numeric,
               metadata = ${JSON.stringify(metadata)}::text::jsonb
         where r.id = ${input.runId} and r.tenant_id = ${input.tenantId} and r.status = 'RUNNING'`;
    },
    findRun: async (executor, tenantId, runId) => {
      const rows = await executor`
        ${runSelect(executor)}
         where r.id = ${runId} and r.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toRun(rows[0]);
    },
    insertCandidates: async (tx, runId, candidates) => {
      for (const candidate of candidates) {
        await tx.sql`
          insert into taxonomy.classification_candidates
            (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
          values
            (${runId}, ${candidate.nodeId}, ${candidate.rank}, ${candidate.confidence}::text::numeric,
             ${[...candidate.matchTypes]}::text[], ${candidate.rationaleSummary})`;
      }
    },
    listCandidates: async (executor, runId) => {
      const rows = await executor`
        select c.classification_run_id, c.node_id, v.code as vocabulary_code, n.canonical_code, c.rank,
               c.confidence::text as confidence, c.match_types, c.rationale_summary, c.accepted,
               c.decided_by_user_id, c.decided_at
          from taxonomy.classification_candidates c
          join taxonomy.nodes n on n.id = c.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where c.classification_run_id = ${runId}
         order by c.rank`;
      return rows.map(toCandidate);
    },
    findCandidate: async (executor, runId, nodeId) => {
      const rows = await executor`
        select c.classification_run_id, c.node_id, v.code as vocabulary_code, n.canonical_code, c.rank,
               c.confidence::text as confidence, c.match_types, c.rationale_summary, c.accepted,
               c.decided_by_user_id, c.decided_at
          from taxonomy.classification_candidates c
          join taxonomy.nodes n on n.id = c.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where c.classification_run_id = ${runId} and c.node_id = ${nodeId}`;
      return rows.length === 0 ? null : toCandidate(rows[0]);
    },
    decideCandidate: async (tx, input) => {
      const rows = await tx.sql`
        update taxonomy.classification_candidates c
           set accepted = ${input.accepted},
               decided_by_user_id = ${input.decidedByUserId},
               decided_at = ${input.decidedAt}::text::timestamptz
         where c.classification_run_id = ${input.runId}
           and c.node_id = ${input.nodeId}
           and c.accepted is null
        returning c.node_id`;
      return rows.length === 1;
    },
  };
}
