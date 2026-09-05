import { z } from "zod";

import {
  DisclosureScopeSchema,
  MessageSensitivitySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import type { DocumentExtractionRepository } from "../application/extraction-ports.js";
import {
  DocumentExtractionIdSchema,
  type DocumentExtraction,
} from "../contracts/extraction.js";
import {
  DocumentIdSchema,
  DocumentProcessingRunIdSchema,
  DocumentVersionIdSchema,
  EvidenceSourceIdSchema,
} from "../contracts/index.js";

/**
 * Extraction metadata in Postgres. The extracted blocks are never stored
 * here: this table says which parser produced which artifact from which run,
 * and where that artifact lives in private storage.
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

const ExtractionRow = z.object({
  id: DocumentExtractionIdSchema,
  tenant_id: TenantIdSchema,
  owner_organisation_id: OrganisationIdSchema,
  document_id: DocumentIdSchema,
  document_version_id: DocumentVersionIdSchema,
  processing_run_id: DocumentProcessingRunIdSchema,
  source_id: EvidenceSourceIdSchema.nullable(),
  schema_version: z.number().int().min(1),
  extractor_id: z.string(),
  extractor_version: z.string(),
  pipeline_version: z.string(),
  artifact_bucket: z.string(),
  artifact_key: z.string(),
  artifact_sha256: z.string(),
  artifact_bytes: z.union([z.number(), z.string()]).transform(Number),
  block_count: z.number().int().min(0),
  page_count: z.number().int().nullable(),
  slide_count: z.number().int().nullable(),
  language: z.string().nullable(),
  visibility_scope: DisclosureScopeSchema,
  sensitivity_class: MessageSensitivitySchema,
  instruction_risk_signals: z.number().int().min(0),
  created_at: Timestamp,
});

function toExtraction(row: unknown): DocumentExtraction {
  const parsed = ExtractionRow.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    ownerOrganisationId: parsed.owner_organisation_id,
    documentId: parsed.document_id,
    documentVersionId: parsed.document_version_id,
    processingRunId: parsed.processing_run_id,
    sourceId: parsed.source_id,
    schemaVersion: parsed.schema_version,
    extractorId: parsed.extractor_id,
    extractorVersion: parsed.extractor_version,
    pipelineVersion: parsed.pipeline_version,
    artifactBucket: parsed.artifact_bucket,
    artifactKey: parsed.artifact_key,
    artifactSha256: parsed.artifact_sha256,
    artifactBytes: parsed.artifact_bytes,
    blockCount: parsed.block_count,
    pageCount: parsed.page_count,
    slideCount: parsed.slide_count,
    language: parsed.language,
    visibilityScope: parsed.visibility_scope,
    sensitivityClass: parsed.sensitivity_class,
    instructionRiskSignals: parsed.instruction_risk_signals,
    createdAt: parsed.created_at,
  };
}

function selectExtractions(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.owner_organisation_id, e.document_id,
           e.document_version_id, e.processing_run_id, e.source_id,
           e.schema_version, e.extractor_id, e.extractor_version,
           e.pipeline_version, e.artifact_bucket, e.artifact_key,
           e.artifact_sha256, e.artifact_bytes, e.block_count, e.page_count,
           e.slide_count, e.language, e.visibility_scope, e.sensitivity_class,
           e.instruction_risk_signals, e.created_at
      from evidence.document_extractions e`;
}

export function createPostgresDocumentExtractionRepository(): DocumentExtractionRepository {
  const findByVersionAndPipeline: DocumentExtractionRepository["findByVersionAndPipeline"] =
    async (executor, tenantId, documentVersionId, pipelineVersion) => {
      const rows = await executor`
        ${selectExtractions(executor)}
         where e.tenant_id = ${tenantId}
           and e.document_version_id = ${documentVersionId}
           and e.pipeline_version = ${pipelineVersion}`;
      return rows.length === 0 ? null : toExtraction(rows[0]);
    };

  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into evidence.document_extractions
          (tenant_id, owner_organisation_id, document_id, document_version_id,
           processing_run_id, source_id, schema_version, extractor_id,
           extractor_version, pipeline_version, artifact_bucket, artifact_key,
           artifact_sha256, artifact_bytes, block_count, page_count, slide_count,
           language, visibility_scope, sensitivity_class, instruction_risk_signals)
        values (${input.tenantId}, ${input.ownerOrganisationId}, ${input.documentId},
                ${input.documentVersionId}, ${input.processingRunId}, ${input.sourceId},
                ${input.schemaVersion}, ${input.extractorId}, ${input.extractorVersion},
                ${input.pipelineVersion}, ${input.artifactBucket}, ${input.artifactKey},
                ${input.artifactSha256}, ${input.artifactBytes}, ${input.blockCount},
                ${input.pageCount}, ${input.slideCount}, ${input.language},
                ${input.visibilityScope}, ${input.sensitivityClass},
                ${input.instructionRiskSignals})
        returning id`;
      const { id } = z
        .object({ id: DocumentExtractionIdSchema })
        .parse(rows[0]);
      const created = await findByVersionAndPipeline(
        tx.sql,
        input.tenantId,
        input.documentVersionId,
        input.pipelineVersion,
      );
      if (created === null || created.id !== id) {
        throw new Error("extraction insert did not return a row");
      }
      return created;
    },
    findByVersionAndPipeline,
    listByVersion: async (executor, tenantId, documentVersionId) => {
      const rows = await executor`
        ${selectExtractions(executor)}
         where e.tenant_id = ${tenantId}
           and e.document_version_id = ${documentVersionId}
         order by e.created_at, e.id`;
      return rows.map(toExtraction);
    },
  };
}
