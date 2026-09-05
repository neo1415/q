import { z } from "zod";

import {
  DisclosureScopeSchema,
  EvidenceStatusSchema,
  LifecycleStatusSchema,
  MessageSensitivitySchema,
  ReliabilityClassSchema,
  TruthClassSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type {
  ClaimEvidenceRepository,
  ClaimRepository,
  DocumentProcessingRunRepository,
  DocumentRepository,
  DocumentVersionRepository,
  EvidenceItemRepository,
  EvidenceRepositories,
  EvidenceSourceRepository,
} from "../application/ports.js";
import {
  ClaimAsserterTypeSchema,
  ClaimEvidenceRelationshipSchema,
  ClaimIdSchema,
  ClaimRevisionIdSchema,
  DocumentIdSchema,
  DocumentProcessingRunIdSchema,
  DocumentStatusSchema,
  DocumentTypeSchema,
  DocumentVersionIdSchema,
  EvidenceItemIdSchema,
  EvidenceLocatorSchema,
  EvidenceSourceIdSchema,
  EvidenceSourceTypeSchema,
  EvidenceSubjectTypeSchema,
  MalwareScanStatusSchema,
  ProcessingRunMetadataSchema,
  ProcessingRunStatusSchema,
  ProcessingStatusSchema,
  SourceMetadataSchema,
  StructuredValueSchema,
  TextExtractionStatusSchema,
  type Claim,
  type ClaimEvidenceLink,
  type ClaimRevision,
  type Document,
  type DocumentProcessingRun,
  type DocumentVersion,
  type EvidenceItem,
  type EvidenceSource,
} from "../contracts/index.js";

/**
 * Postgres adapters. Parameterised SQL only, every statement carries the
 * tenant, and nothing here is exported from the package's public surface
 * except through `createPostgresEvidenceRepositories`. Query ports for
 * other contexts live in `postgres-query-ports.ts`.
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
const Json = z
  .unknown()
  .transform((value) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : value,
  );

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SourceRow = z.object({
  id: EvidenceSourceIdSchema,
  tenant_id: TenantIdSchema,
  source_type: EvidenceSourceTypeSchema,
  subject_type: EvidenceSubjectTypeSchema,
  subject_id: z.string(),
  provider: z.string().nullable(),
  external_reference: z.string().nullable(),
  title: z.string().nullable(),
  source_url: z.string().nullable(),
  created_by_user_id: UserIdSchema.nullable(),
  retrieved_at: Timestamp.nullable(),
  published_at: Timestamp.nullable(),
  reliability_class: ReliabilityClassSchema.nullable(),
  visibility_scope: DisclosureScopeSchema,
  sensitivity_class: MessageSensitivitySchema,
  metadata: Json.pipe(SourceMetadataSchema),
  created_at: Timestamp,
});

function toSource(row: unknown): EvidenceSource {
  const r = SourceRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sourceType: r.source_type,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    provider: r.provider,
    externalReference: r.external_reference,
    title: r.title,
    sourceUrl: r.source_url,
    createdByUserId: r.created_by_user_id,
    retrievedAt: r.retrieved_at,
    publishedAt: r.published_at,
    reliabilityClass: r.reliability_class,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    metadata: r.metadata,
    createdAt: r.created_at,
  };
}

function selectSources(executor: DatabaseExecutor) {
  return executor`
    select s.id, s.tenant_id, s.source_type, s.subject_type, s.subject_id, s.provider,
           s.external_reference, s.title, s.source_url, s.created_by_user_id, s.retrieved_at,
           s.published_at, s.reliability_class, s.visibility_scope, s.sensitivity_class,
           s.metadata, s.created_at
      from evidence.sources s`;
}

export function createPostgresEvidenceSourceRepository(): EvidenceSourceRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into evidence.sources
          (tenant_id, source_type, subject_type, subject_id, provider, external_reference, title,
           source_url, created_by_user_id, retrieved_at, published_at, reliability_class,
           visibility_scope, sensitivity_class, metadata)
        values (${input.tenantId}, ${input.sourceType}, ${input.subjectType}, ${input.subjectId},
                ${input.provider}, ${input.externalReference}, ${input.title}, ${input.sourceUrl},
                ${input.createdByUserId}, ${input.retrievedAt}, ${input.publishedAt},
                ${input.reliabilityClass}, ${input.visibilityScope}, ${input.sensitivityClass},
                ${tx.sql.json(input.metadata)}::jsonb)
        returning id`;
      const { id } = z.object({ id: EvidenceSourceIdSchema }).parse(rows[0]);
      const created = await tx.sql`
        ${selectSources(tx.sql)} where s.id = ${id} and s.tenant_id = ${input.tenantId}`;
      return toSource(created[0]);
    },
    findById: async (executor, tenantId, sourceId) => {
      const rows = await executor`
        ${selectSources(executor)} where s.id = ${sourceId} and s.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toSource(rows[0]);
    },
    listBySubject: async (executor, tenantId, subject) => {
      const rows = await executor`
        ${selectSources(executor)}
         where s.tenant_id = ${tenantId}
           and s.subject_type = ${subject.subjectType}
           and s.subject_id = ${subject.subjectId}
         order by s.created_at desc, s.id desc`;
      return rows.map(toSource);
    },
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const DocumentRow = z.object({
  id: DocumentIdSchema,
  tenant_id: TenantIdSchema,
  company_id: z.string().nullable(),
  owner_organisation_id: OrganisationIdSchema,
  document_type: DocumentTypeSchema,
  title: z.string(),
  visibility_scope: DisclosureScopeSchema,
  sensitivity_class: MessageSensitivitySchema,
  current_version_id: DocumentVersionIdSchema.nullable(),
  status: DocumentStatusSchema,
  created_by_user_id: UserIdSchema,
  created_at: Timestamp,
  updated_at: Timestamp,
  version: z.number().int().min(1),
});

function toDocument(row: unknown): Document {
  const r = DocumentRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    companyId: r.company_id,
    ownerOrganisationId: r.owner_organisation_id,
    documentType: r.document_type,
    title: r.title,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    currentVersionId: r.current_version_id,
    status: r.status,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
}

function selectDocuments(executor: DatabaseExecutor) {
  return executor`
    select d.id, d.tenant_id, d.company_id, d.owner_organisation_id, d.document_type, d.title,
           d.visibility_scope, d.sensitivity_class, d.current_version_id, d.status,
           d.created_by_user_id, d.created_at, d.updated_at, d.version
      from evidence.documents d`;
}

export function createPostgresDocumentRepository(): DocumentRepository {
  const findById: DocumentRepository["findById"] = async (
    executor,
    tenantId,
    ownerOrganisationId,
    documentId,
  ) => {
    const rows = await executor`
      ${selectDocuments(executor)}
       where d.id = ${documentId}
         and d.tenant_id = ${tenantId}
         and d.owner_organisation_id = ${ownerOrganisationId}`;
    return rows.length === 0 ? null : toDocument(rows[0]);
  };
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into evidence.documents
          (tenant_id, company_id, owner_organisation_id, document_type, title,
           visibility_scope, sensitivity_class, created_by_user_id)
        values (${input.tenantId}, ${input.companyId}, ${input.ownerOrganisationId},
                ${input.documentType}, ${input.title}, ${input.visibilityScope},
                ${input.sensitivityClass}, ${input.createdByUserId})
        returning id`;
      const { id } = z.object({ id: DocumentIdSchema }).parse(rows[0]);
      const created = await findById(
        tx.sql,
        input.tenantId,
        input.ownerOrganisationId,
        id,
      );
      if (created === null) {
        throw new Error("document insert did not return a row");
      }
      return created;
    },
    findById,
    findInTenant: async (executor, tenantId, documentId) => {
      const rows = await executor`
        ${selectDocuments(executor)} where d.id = ${documentId} and d.tenant_id = ${tenantId}`;
      return rows.length === 0 ? null : toDocument(rows[0]);
    },
    lockById: async (tx, tenantId, ownerOrganisationId, documentId) => {
      const rows = await tx.sql`
        ${selectDocuments(tx.sql)}
         where d.id = ${documentId}
           and d.tenant_id = ${tenantId}
           and d.owner_organisation_id = ${ownerOrganisationId}
         for update`;
      return rows.length === 0 ? null : toDocument(rows[0]);
    },
    listByOwner: async (executor, tenantId, ownerOrganisationId, filter) => {
      const rows =
        filter.companyId === undefined
          ? await executor`
              ${selectDocuments(executor)}
               where d.tenant_id = ${tenantId}
                 and d.owner_organisation_id = ${ownerOrganisationId}
               order by d.created_at desc, d.id desc`
          : await executor`
              ${selectDocuments(executor)}
               where d.tenant_id = ${tenantId}
                 and d.owner_organisation_id = ${ownerOrganisationId}
                 and d.company_id = ${filter.companyId}
               order by d.created_at desc, d.id desc`;
      return rows.map(toDocument);
    },
    setCurrentVersion: async (tx, input) => {
      const rows = await tx.sql`
        update evidence.documents d
           set current_version_id = ${input.currentVersionId},
               version = d.version + 1
         where d.id = ${input.documentId}
           and d.tenant_id = ${input.tenantId}
           and d.version = ${input.expectedVersion}
        returning d.id`;
      return rows.length === 1;
    },
    updateDetails: async (tx, input) => {
      const { changes } = input;
      const rows = await tx.sql`
        update evidence.documents d
           set title = coalesce(${changes.title ?? null}, d.title),
               document_type = coalesce(${changes.documentType ?? null}, d.document_type),
               sensitivity_class = coalesce(${changes.sensitivityClass ?? null}, d.sensitivity_class),
               status = coalesce(${changes.status ?? null}, d.status),
               version = d.version + 1
         where d.id = ${input.documentId}
           and d.tenant_id = ${input.tenantId}
           and d.version = ${input.expectedVersion}
        returning d.id`;
      return rows.length === 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Document versions
// ---------------------------------------------------------------------------

const VersionRow = z.object({
  id: DocumentVersionIdSchema,
  tenant_id: TenantIdSchema,
  document_id: DocumentIdSchema,
  version_number: z.number().int().min(1),
  storage_bucket: z.string(),
  storage_key: z.string(),
  original_filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.union([z.number(), z.string()]).transform(Number),
  sha256: z.string(),
  uploaded_by_user_id: UserIdSchema,
  uploaded_at: Timestamp,
  supersedes_version_id: DocumentVersionIdSchema.nullable(),
  processing_status: ProcessingStatusSchema,
  malware_scan_status: MalwareScanStatusSchema,
  text_extraction_status: TextExtractionStatusSchema,
});

function toVersion(row: unknown): DocumentVersion {
  const r = VersionRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    documentId: r.document_id,
    versionNumber: r.version_number,
    storageBucket: r.storage_bucket,
    storageKey: r.storage_key,
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    uploadedByUserId: r.uploaded_by_user_id,
    uploadedAt: r.uploaded_at,
    supersedesVersionId: r.supersedes_version_id,
    processingStatus: r.processing_status,
    malwareScanStatus: r.malware_scan_status,
    textExtractionStatus: r.text_extraction_status,
  };
}

function selectVersions(executor: DatabaseExecutor) {
  return executor`
    select v.id, v.tenant_id, v.document_id, v.version_number, v.storage_bucket, v.storage_key,
           v.original_filename, v.mime_type, v.size_bytes, v.sha256, v.uploaded_by_user_id,
           v.uploaded_at, v.supersedes_version_id, v.processing_status, v.malware_scan_status,
           v.text_extraction_status
      from evidence.document_versions v`;
}

export function createPostgresDocumentVersionRepository(): DocumentVersionRepository {
  const findById: DocumentVersionRepository["findById"] = async (
    executor,
    tenantId,
    versionId,
  ) => {
    const rows = await executor`
      ${selectVersions(executor)} where v.id = ${versionId} and v.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toVersion(rows[0]);
  };
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into evidence.document_versions
          (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename,
           mime_type, size_bytes, sha256, uploaded_by_user_id, supersedes_version_id)
        values (${input.tenantId}, ${input.documentId}, ${input.versionNumber}, ${input.storageBucket},
                ${input.storageKey}, ${input.originalFilename}, ${input.mimeType}, ${input.sizeBytes},
                ${input.sha256}, ${input.uploadedByUserId}, ${input.supersedesVersionId})
        returning id`;
      const { id } = z.object({ id: DocumentVersionIdSchema }).parse(rows[0]);
      const created = await findById(tx.sql, input.tenantId, id);
      if (created === null) {
        throw new Error("document version insert did not return a row");
      }
      return created;
    },
    findById,
    listByDocument: async (executor, tenantId, documentId) => {
      const rows = await executor`
        ${selectVersions(executor)}
         where v.tenant_id = ${tenantId} and v.document_id = ${documentId}
         order by v.version_number desc`;
      return rows.map(toVersion);
    },
    findBySha256: async (executor, tenantId, ownerOrganisationId, sha256) => {
      // Joined through the owning document so the organisation boundary is
      // part of the predicate, not an afterthought.
      const rows = await executor`
        select v.id, v.tenant_id, v.document_id, v.version_number, v.storage_bucket, v.storage_key,
               v.original_filename, v.mime_type, v.size_bytes, v.sha256, v.uploaded_by_user_id,
               v.uploaded_at, v.supersedes_version_id, v.processing_status, v.malware_scan_status,
               v.text_extraction_status
          from evidence.document_versions v
          join evidence.documents d on d.id = v.document_id and d.tenant_id = v.tenant_id
         where v.tenant_id = ${tenantId}
           and d.owner_organisation_id = ${ownerOrganisationId}
           and v.sha256 = ${sha256}
         order by v.uploaded_at, v.id`;
      return rows.map(toVersion);
    },
    updateProcessingState: async (tx, input) => {
      const { changes } = input;
      const rows = await tx.sql`
        update evidence.document_versions v
           set processing_status = coalesce(${changes.processingStatus ?? null}, v.processing_status),
               malware_scan_status = coalesce(${changes.malwareScanStatus ?? null}, v.malware_scan_status),
               text_extraction_status = coalesce(${changes.textExtractionStatus ?? null}, v.text_extraction_status)
         where v.id = ${input.versionId} and v.tenant_id = ${input.tenantId}
        returning v.id`;
      if (rows.length === 0) {
        return null;
      }
      return findById(tx.sql, input.tenantId, input.versionId);
    },
  };
}

// ---------------------------------------------------------------------------
// Processing runs
// ---------------------------------------------------------------------------

const RunRow = z.object({
  id: DocumentProcessingRunIdSchema,
  document_version_id: DocumentVersionIdSchema,
  pipeline_version: z.string(),
  status: ProcessingRunStatusSchema,
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  error_code: z.string().nullable(),
  extractor_version: z.string().nullable(),
  classifier_version: z.string().nullable(),
  embedding_model_id: z.string().nullable(),
  cost_usd: z.union([z.number(), z.string()]).transform(String),
  metadata: Json.pipe(ProcessingRunMetadataSchema),
  created_at: Timestamp,
});

function toRun(row: unknown): DocumentProcessingRun {
  const r = RunRow.parse(row);
  return {
    id: r.id,
    documentVersionId: r.document_version_id,
    pipelineVersion: r.pipeline_version,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    errorCode: r.error_code,
    extractorVersion: r.extractor_version,
    classifierVersion: r.classifier_version,
    embeddingModelId: r.embedding_model_id,
    costUsd: r.cost_usd,
    metadata: r.metadata,
    createdAt: r.created_at,
  };
}

/** Runs carry no tenant column; the version they belong to scopes them. */
function selectRuns(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.document_version_id, r.pipeline_version, r.status, r.started_at, r.completed_at,
           r.error_code, r.extractor_version, r.classifier_version, r.embedding_model_id,
           r.cost_usd, r.metadata, r.created_at
      from evidence.document_processing_runs r
      join evidence.document_versions v on v.id = r.document_version_id`;
}

export function createPostgresDocumentProcessingRunRepository(): DocumentProcessingRunRepository {
  const findById: DocumentProcessingRunRepository["findById"] = async (
    executor,
    tenantId,
    runId,
  ) => {
    const rows = await executor`
      ${selectRuns(executor)} where r.id = ${runId} and v.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toRun(rows[0]);
  };
  return {
    getOrCreate: async (tx, input) => {
      // The unique key makes a concurrent second registration land on the
      // same row; `on conflict do nothing` plus a re-read keeps it one run.
      const inserted = await tx.sql`
        insert into evidence.document_processing_runs (document_version_id, pipeline_version)
        select v.id, ${input.pipelineVersion}
          from evidence.document_versions v
         where v.id = ${input.documentVersionId} and v.tenant_id = ${input.tenantId}
        on conflict (document_version_id, pipeline_version) do nothing
        returning id`;
      const rows = await tx.sql`
        ${selectRuns(tx.sql)}
         where r.document_version_id = ${input.documentVersionId}
           and r.pipeline_version = ${input.pipelineVersion}
           and v.tenant_id = ${input.tenantId}`;
      if (rows.length === 0) {
        throw new Error("processing run registration did not return a row");
      }
      return { run: toRun(rows[0]), created: inserted.length === 1 };
    },
    listByVersion: async (executor, tenantId, documentVersionId) => {
      const rows = await executor`
        ${selectRuns(executor)}
         where r.document_version_id = ${documentVersionId} and v.tenant_id = ${tenantId}
         order by r.created_at, r.id`;
      return rows.map(toRun);
    },
    findById,
    transition: async (tx, input) => {
      const rows = await tx.sql`
        update evidence.document_processing_runs r
           set status = ${input.status},
               error_code = ${input.errorCode},
               started_at = case when ${input.status} = 'RUNNING' then clock_timestamp() else r.started_at end,
               completed_at = case when ${input.status} in ('COMPLETED', 'FAILED') then clock_timestamp() else null end
          from evidence.document_versions v
         where r.id = ${input.runId}
           and v.id = r.document_version_id
           and v.tenant_id = ${input.tenantId}
        returning r.id`;
      if (rows.length === 0) {
        return null;
      }
      return findById(tx.sql, input.tenantId, input.runId);
    },
  };
}

// ---------------------------------------------------------------------------
// Claims and revisions
// ---------------------------------------------------------------------------

const ClaimRow = z.object({
  id: ClaimIdSchema,
  tenant_id: TenantIdSchema,
  subject_type: EvidenceSubjectTypeSchema,
  subject_id: z.string(),
  claim_type: z.string(),
  claim_key: z.string(),
  statement: z.string(),
  structured_value: Json.pipe(StructuredValueSchema.nullable()),
  asserted_by_type: ClaimAsserterTypeSchema,
  asserted_by_id: z.string(),
  asserted_at: Timestamp,
  valid_from: Timestamp.nullable(),
  valid_to: Timestamp.nullable(),
  truth_class: TruthClassSchema,
  evidence_status: EvidenceStatusSchema,
  lifecycle_status: LifecycleStatusSchema,
  visibility_scope: DisclosureScopeSchema,
  sensitivity_class: MessageSensitivitySchema,
  current_revision_id: ClaimRevisionIdSchema,
  current_revision_number: z.number().int().min(1),
  created_at: Timestamp,
});

function toClaim(row: unknown): Claim {
  const r = ClaimRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    claimType: r.claim_type,
    claimKey: r.claim_key,
    statement: r.statement,
    structuredValue: r.structured_value,
    assertedByType: r.asserted_by_type,
    assertedById: r.asserted_by_id,
    assertedAt: r.asserted_at,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    truthClass: r.truth_class,
    evidenceStatus: r.evidence_status,
    lifecycleStatus: r.lifecycle_status,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    currentRevisionId: r.current_revision_id,
    currentRevisionNumber: r.current_revision_number,
    createdAt: r.created_at,
  };
}

const RevisionRow = z.object({
  id: ClaimRevisionIdSchema,
  tenant_id: TenantIdSchema,
  claim_id: ClaimIdSchema,
  revision_number: z.number().int().min(1),
  statement: z.string(),
  structured_value: Json.pipe(StructuredValueSchema.nullable()),
  truth_class: TruthClassSchema,
  evidence_status: EvidenceStatusSchema,
  lifecycle_status: LifecycleStatusSchema,
  valid_from: Timestamp.nullable(),
  valid_to: Timestamp.nullable(),
  change_reason: z.string().nullable(),
  changed_by_type: ClaimAsserterTypeSchema,
  changed_by_id: z.string(),
  source_id: EvidenceSourceIdSchema.nullable(),
  created_at: Timestamp,
});

function toRevision(row: unknown): ClaimRevision {
  const r = RevisionRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    claimId: r.claim_id,
    revisionNumber: r.revision_number,
    statement: r.statement,
    structuredValue: r.structured_value,
    truthClass: r.truth_class,
    evidenceStatus: r.evidence_status,
    lifecycleStatus: r.lifecycle_status,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    changeReason: r.change_reason,
    changedByType: r.changed_by_type,
    changedById: r.changed_by_id,
    sourceId: r.source_id,
    createdAt: r.created_at,
  };
}

function selectClaims(executor: DatabaseExecutor) {
  return executor`
    select c.id, c.tenant_id, c.subject_type, c.subject_id, c.claim_type, c.claim_key, c.statement,
           c.structured_value, c.asserted_by_type, c.asserted_by_id, c.asserted_at, c.valid_from,
           c.valid_to, c.truth_class, c.evidence_status, c.lifecycle_status, c.visibility_scope,
           c.sensitivity_class, c.current_revision_id, c.current_revision_number, c.created_at
      from evidence.claims c`;
}

function selectRevisions(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.claim_id, r.revision_number, r.statement, r.structured_value,
           r.truth_class, r.evidence_status, r.lifecycle_status, r.valid_from, r.valid_to,
           r.change_reason, r.changed_by_type, r.changed_by_id, r.source_id, r.created_at
      from evidence.claim_revisions r`;
}

export function createPostgresClaimRepository(): ClaimRepository {
  const findById: ClaimRepository["findById"] = async (
    executor,
    tenantId,
    claimId,
  ) => {
    const rows = await executor`
      ${selectClaims(executor)} where c.id = ${claimId} and c.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toClaim(rows[0]);
  };
  return {
    insert: async (tx, input) => {
      const structured = input.structuredValue;
      // The claim row is written first with a placeholder revision pointer
      // resolved inside the same statement pair; the deferred FK lets the
      // revision reference the claim and the claim reference the revision.
      const claimRows = await tx.sql`
        insert into evidence.claims
          (tenant_id, subject_type, subject_id, claim_type, claim_key, statement, structured_value,
           asserted_by_type, asserted_by_id, asserted_at, valid_from, valid_to, truth_class,
           evidence_status, lifecycle_status, visibility_scope, sensitivity_class,
           current_revision_id, current_revision_number)
        values (${input.tenantId}, ${input.subjectType}, ${input.subjectId}, ${input.claimType},
                ${input.claimKey}, ${input.statement}, ${structured === null ? null : tx.sql.json(structured)}::jsonb, ${input.assertedByType},
                ${input.assertedById}, ${input.assertedAt}, ${input.validFrom}, ${input.validTo},
                ${input.truthClass}, ${input.evidenceStatus}, ${input.lifecycleStatus},
                ${input.visibilityScope}, ${input.sensitivityClass}, gen_random_uuid(), 1)
        returning id, current_revision_id`;
      const claim = z
        .object({
          id: ClaimIdSchema,
          current_revision_id: ClaimRevisionIdSchema,
        })
        .parse(claimRows[0]);
      await tx.sql`
        insert into evidence.claim_revisions
          (id, tenant_id, claim_id, revision_number, statement, structured_value, truth_class,
           evidence_status, lifecycle_status, valid_from, valid_to, change_reason, changed_by_type,
           changed_by_id, source_id)
        values (${claim.current_revision_id}, ${input.tenantId}, ${claim.id}, 1, ${input.statement},
                ${structured === null ? null : tx.sql.json(structured)}::jsonb, ${input.truthClass}, ${input.evidenceStatus},
                ${input.lifecycleStatus}, ${input.validFrom}, ${input.validTo}, null,
                ${input.changedByType}, ${input.changedById}, ${input.sourceId})`;
      const created = await findById(tx.sql, input.tenantId, claim.id);
      if (created === null) {
        throw new Error("claim insert did not return a row");
      }
      return created;
    },
    revise: async (tx, input) => {
      const structured = input.structuredValue;
      const nextNumber = input.expectedRevisionNumber + 1;
      const revisionRows = await tx.sql`
        insert into evidence.claim_revisions
          (tenant_id, claim_id, revision_number, statement, structured_value, truth_class,
           evidence_status, lifecycle_status, valid_from, valid_to, change_reason, changed_by_type,
           changed_by_id, source_id)
        select ${input.tenantId}, c.id, ${nextNumber}, ${input.statement}, ${structured === null ? null : tx.sql.json(structured)}::jsonb,
               ${input.truthClass}, ${input.evidenceStatus}, ${input.lifecycleStatus},
               ${input.validFrom}, ${input.validTo}, ${input.changeReason}, ${input.changedByType},
               ${input.changedById}, ${input.sourceId}
          from evidence.claims c
         where c.id = ${input.claimId}
           and c.tenant_id = ${input.tenantId}
           and c.current_revision_number = ${input.expectedRevisionNumber}
        returning id`;
      if (revisionRows.length === 0) {
        return null;
      }
      const { id: revisionId } = z
        .object({ id: ClaimRevisionIdSchema })
        .parse(revisionRows[0]);
      const updated = await tx.sql`
        update evidence.claims c
           set statement = ${input.statement},
               structured_value = ${structured === null ? null : tx.sql.json(structured)}::jsonb,
               truth_class = ${input.truthClass},
               evidence_status = ${input.evidenceStatus},
               lifecycle_status = ${input.lifecycleStatus},
               valid_from = ${input.validFrom},
               valid_to = ${input.validTo},
               current_revision_id = ${revisionId},
               current_revision_number = ${nextNumber}
         where c.id = ${input.claimId}
           and c.tenant_id = ${input.tenantId}
           and c.current_revision_number = ${input.expectedRevisionNumber}
        returning c.id`;
      if (updated.length === 0) {
        return null;
      }
      return findById(tx.sql, input.tenantId, input.claimId);
    },
    findById,
    lockById: async (tx, tenantId, claimId) => {
      const rows = await tx.sql`
        ${selectClaims(tx.sql)} where c.id = ${claimId} and c.tenant_id = ${tenantId} for update`;
      return rows.length === 0 ? null : toClaim(rows[0]);
    },
    listBySubject: async (executor, tenantId, subject, filter) => {
      const rows =
        filter.claimKey === undefined
          ? await executor`
              ${selectClaims(executor)}
               where c.tenant_id = ${tenantId}
                 and c.subject_type = ${subject.subjectType}
                 and c.subject_id = ${subject.subjectId}
               order by c.claim_key, c.asserted_at desc, c.id`
          : await executor`
              ${selectClaims(executor)}
               where c.tenant_id = ${tenantId}
                 and c.subject_type = ${subject.subjectType}
                 and c.subject_id = ${subject.subjectId}
                 and c.claim_key = ${filter.claimKey}
               order by c.asserted_at desc, c.id`;
      return rows.map(toClaim);
    },
    listRevisions: async (executor, tenantId, claimId) => {
      const rows = await executor`
        ${selectRevisions(executor)}
         where r.tenant_id = ${tenantId} and r.claim_id = ${claimId}
         order by r.revision_number`;
      return rows.map(toRevision);
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence items and claim-evidence links
// ---------------------------------------------------------------------------

const ItemRow = z.object({
  id: EvidenceItemIdSchema,
  tenant_id: TenantIdSchema,
  source_id: EvidenceSourceIdSchema,
  subject_type: EvidenceSubjectTypeSchema,
  subject_id: z.string(),
  evidence_type: z.string(),
  summary: z.string(),
  structured_value: Json.pipe(StructuredValueSchema.nullable()),
  locator: Json.pipe(EvidenceLocatorSchema),
  valid_from: Timestamp.nullable(),
  valid_to: Timestamp.nullable(),
  evidence_status: EvidenceStatusSchema,
  reliability_class: ReliabilityClassSchema.nullable(),
  visibility_scope: DisclosureScopeSchema,
  sensitivity_class: MessageSensitivitySchema,
  created_by_user_id: UserIdSchema.nullable(),
  created_at: Timestamp,
});

function toItem(row: unknown): EvidenceItem {
  const r = ItemRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sourceId: r.source_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    evidenceType: r.evidence_type,
    summary: r.summary,
    structuredValue: r.structured_value,
    locator: r.locator,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    evidenceStatus: r.evidence_status,
    reliabilityClass: r.reliability_class,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
  };
}

function selectItems(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.source_id, e.subject_type, e.subject_id, e.evidence_type, e.summary,
           e.structured_value, e.locator, e.valid_from, e.valid_to, e.evidence_status,
           e.reliability_class, e.visibility_scope, e.sensitivity_class, e.created_by_user_id,
           e.created_at
      from evidence.evidence_items e`;
}

export function createPostgresEvidenceItemRepository(): EvidenceItemRepository {
  const findById: EvidenceItemRepository["findById"] = async (
    executor,
    tenantId,
    evidenceItemId,
  ) => {
    const rows = await executor`
      ${selectItems(executor)} where e.id = ${evidenceItemId} and e.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toItem(rows[0]);
  };
  return {
    insert: async (tx, input) => {
      const structured = input.structuredValue;
      const rows = await tx.sql`
        insert into evidence.evidence_items
          (tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value,
           locator, valid_from, valid_to, evidence_status, reliability_class, visibility_scope,
           sensitivity_class, created_by_user_id)
        values (${input.tenantId}, ${input.sourceId}, ${input.subjectType}, ${input.subjectId},
                ${input.evidenceType}, ${input.summary}, ${structured === null ? null : tx.sql.json(structured)}::jsonb,
                ${tx.sql.json(input.locator)}::jsonb, ${input.validFrom}, ${input.validTo},
                ${input.evidenceStatus}, ${input.reliabilityClass}, ${input.visibilityScope},
                ${input.sensitivityClass}, ${input.createdByUserId})
        returning id`;
      const { id } = z.object({ id: EvidenceItemIdSchema }).parse(rows[0]);
      const created = await findById(tx.sql, input.tenantId, id);
      if (created === null) {
        throw new Error("evidence item insert did not return a row");
      }
      return created;
    },
    findById,
    listBySubject: async (executor, tenantId, subject) => {
      const rows = await executor`
        ${selectItems(executor)}
         where e.tenant_id = ${tenantId}
           and e.subject_type = ${subject.subjectType}
           and e.subject_id = ${subject.subjectId}
         order by e.created_at desc, e.id desc`;
      return rows.map(toItem);
    },
    listBySource: async (executor, tenantId, sourceId) => {
      const rows = await executor`
        ${selectItems(executor)}
         where e.tenant_id = ${tenantId} and e.source_id = ${sourceId}
         order by e.created_at, e.id`;
      return rows.map(toItem);
    },
  };
}

const LinkRow = z.object({
  tenant_id: TenantIdSchema,
  claim_id: ClaimIdSchema,
  evidence_item_id: EvidenceItemIdSchema,
  relationship: ClaimEvidenceRelationshipSchema,
  weight: z
    .union([z.number(), z.string()])
    .nullable()
    .transform((v) => (v === null ? null : String(v))),
  created_by_user_id: UserIdSchema.nullable(),
  created_at: Timestamp,
});

function toLink(row: unknown): ClaimEvidenceLink {
  const r = LinkRow.parse(row);
  return {
    tenantId: r.tenant_id,
    claimId: r.claim_id,
    evidenceItemId: r.evidence_item_id,
    relationship: r.relationship,
    weight: r.weight,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
  };
}

function selectLinks(executor: DatabaseExecutor) {
  return executor`
    select l.tenant_id, l.claim_id, l.evidence_item_id, l.relationship, l.weight,
           l.created_by_user_id, l.created_at
      from evidence.claim_evidence l`;
}

export function createPostgresClaimEvidenceRepository(): ClaimEvidenceRepository {
  return {
    link: async (tx, input) => {
      const inserted = await tx.sql`
        insert into evidence.claim_evidence
          (tenant_id, claim_id, evidence_item_id, relationship, weight, created_by_user_id)
        values (${input.tenantId}, ${input.claimId}, ${input.evidenceItemId}, ${input.relationship},
                ${input.weight}::numeric, ${input.createdByUserId})
        on conflict (claim_id, evidence_item_id, relationship) do nothing
        returning claim_id`;
      const rows = await tx.sql`
        ${selectLinks(tx.sql)}
         where l.tenant_id = ${input.tenantId}
           and l.claim_id = ${input.claimId}
           and l.evidence_item_id = ${input.evidenceItemId}
           and l.relationship = ${input.relationship}`;
      if (rows.length === 0) {
        throw new Error("claim evidence link did not return a row");
      }
      return { link: toLink(rows[0]), created: inserted.length === 1 };
    },
    listByClaim: async (executor, tenantId, claimId) => {
      const rows = await executor`
        ${selectLinks(executor)}
         where l.tenant_id = ${tenantId} and l.claim_id = ${claimId}
         order by l.created_at, l.evidence_item_id, l.relationship`;
      return rows.map(toLink);
    },
    listByEvidenceItem: async (executor, tenantId, evidenceItemId) => {
      const rows = await executor`
        ${selectLinks(executor)}
         where l.tenant_id = ${tenantId} and l.evidence_item_id = ${evidenceItemId}
         order by l.created_at, l.claim_id, l.relationship`;
      return rows.map(toLink);
    },
  };
}

export function createPostgresEvidenceRepositories(): EvidenceRepositories {
  return {
    sources: createPostgresEvidenceSourceRepository(),
    documents: createPostgresDocumentRepository(),
    documentVersions: createPostgresDocumentVersionRepository(),
    processingRuns: createPostgresDocumentProcessingRunRepository(),
    claims: createPostgresClaimRepository(),
    evidenceItems: createPostgresEvidenceItemRepository(),
    claimEvidence: createPostgresClaimEvidenceRepository(),
  };
}

export type { TransactionContext };
