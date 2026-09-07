import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  DocumentExtractionIdSchema,
  DocumentIdSchema,
  DocumentVersionIdSchema,
  EvidenceSourceIdSchema,
  EvidenceSubjectTypeSchema,
} from "@capital-q/evidence/contracts";
import { OrganisationIdSchema, TenantIdSchema } from "@capital-q/security";

import type {
  ChunkRepository,
  ChunkSetRepository,
  QKnowledgeRepositories,
} from "../application/ports.js";
import {
  ChunkIdSchema,
  ChunkKindSchema,
  ChunkLocatorSchema,
  ChunkRoleSchema,
  ChunkSetIdSchema,
  ChunkSetStatusReasonSchema,
  ChunkSetStatusSchema,
  ChunkingStrategySchema,
  type Chunk,
  type ChunkSet,
} from "../contracts/index.js";

/**
 * The derived chunk store in Postgres (`q_knowledge.chunk_sets`,
 * `q_knowledge.chunks`). Every read is tenant-scoped in SQL; every write
 * carries the tenant on the row so the composite foreign keys hold the
 * chain source → document → version → extraction → set → chunk inside one
 * tenant. Lifecycle changes are the only updates the triggers allow.
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

const ChunkSetRow = z.object({
  id: ChunkSetIdSchema,
  tenant_id: TenantIdSchema,
  owner_organisation_id: OrganisationIdSchema,
  source_id: EvidenceSourceIdSchema.nullable(),
  document_id: DocumentIdSchema,
  document_version_id: DocumentVersionIdSchema,
  extraction_id: DocumentExtractionIdSchema,
  subject_type: EvidenceSubjectTypeSchema,
  subject_id: z.string().uuid(),
  extractor_id: z.string(),
  extractor_version: z.string(),
  chunking_strategy: ChunkingStrategySchema,
  chunking_version: z.string(),
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  status: ChunkSetStatusSchema,
  status_reason: ChunkSetStatusReasonSchema.nullable(),
  invalidated_at: Timestamp.nullable(),
  chunk_count: z.number().int(),
  token_estimate: z.number().int(),
  created_at: Timestamp,
});

function toChunkSet(row: unknown): ChunkSet {
  const r = ChunkSetRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    ownerOrganisationId: r.owner_organisation_id,
    sourceId: r.source_id,
    documentId: r.document_id,
    documentVersionId: r.document_version_id,
    extractionId: r.extraction_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    extractorId: r.extractor_id,
    extractorVersion: r.extractor_version,
    chunkingStrategy: r.chunking_strategy,
    chunkingVersion: r.chunking_version,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    status: r.status,
    statusReason: r.status_reason,
    invalidatedAt: r.invalidated_at,
    chunkCount: r.chunk_count,
    tokenEstimate: r.token_estimate,
    createdAt: r.created_at,
  };
}

const ChunkRow = z.object({
  id: ChunkIdSchema,
  tenant_id: TenantIdSchema,
  chunk_set_id: ChunkSetIdSchema,
  document_version_id: DocumentVersionIdSchema,
  subject_type: EvidenceSubjectTypeSchema,
  subject_id: z.string().uuid(),
  parent_chunk_id: ChunkIdSchema.nullable(),
  chunk_index: z.number().int(),
  role: ChunkRoleSchema,
  chunk_kind: ChunkKindSchema,
  content: z.string(),
  content_sha256: z.string(),
  token_estimate: z.number().int(),
  block_index_start: z.number().int(),
  block_index_end: z.number().int(),
  locator: ChunkLocatorSchema,
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  instruction_risk_signals: z.number().int(),
  status: ChunkSetStatusSchema,
  invalidated_at: Timestamp.nullable(),
  created_at: Timestamp,
});

/** Shared with the embedding repository, which selects the same columns. */
export function toChunk(row: unknown): Chunk {
  const r = ChunkRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    chunkSetId: r.chunk_set_id,
    documentVersionId: r.document_version_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    parentChunkId: r.parent_chunk_id,
    chunkIndex: r.chunk_index,
    role: r.role,
    kind: r.chunk_kind,
    content: r.content,
    contentSha256: r.content_sha256,
    tokenEstimate: r.token_estimate,
    blockIndexStart: r.block_index_start,
    blockIndexEnd: r.block_index_end,
    locator: r.locator,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    instructionRiskSignals: r.instruction_risk_signals,
    status: r.status,
    invalidatedAt: r.invalidated_at,
    createdAt: r.created_at,
  };
}

function selectChunkSets(executor: DatabaseExecutor) {
  return executor`
    select s.id, s.tenant_id, s.owner_organisation_id, s.source_id, s.document_id,
           s.document_version_id, s.extraction_id, s.subject_type, s.subject_id,
           s.extractor_id, s.extractor_version, s.chunking_strategy, s.chunking_version,
           s.visibility_scope, s.sensitivity_class, s.status, s.status_reason,
           s.invalidated_at, s.chunk_count, s.token_estimate, s.created_at
      from q_knowledge.chunk_sets s`;
}

function selectChunks(executor: DatabaseExecutor) {
  return executor`
    select c.id, c.tenant_id, c.chunk_set_id, c.document_version_id, c.subject_type,
           c.subject_id, c.parent_chunk_id, c.chunk_index, c.role, c.chunk_kind,
           c.content, c.content_sha256, c.token_estimate, c.block_index_start,
           c.block_index_end, c.locator, c.visibility_scope, c.sensitivity_class,
           c.instruction_risk_signals, c.status, c.invalidated_at, c.created_at
      from q_knowledge.chunks c`;
}

export function createPostgresChunkSetRepository(): ChunkSetRepository {
  const findById: ChunkSetRepository["findById"] = async (
    executor,
    tenantId,
    chunkSetId,
  ) => {
    const rows = await executor`
      ${selectChunkSets(executor)}
       where s.tenant_id = ${tenantId} and s.id = ${chunkSetId}`;
    return rows.length === 0 ? null : toChunkSet(rows[0]);
  };

  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into q_knowledge.chunk_sets
          (tenant_id, owner_organisation_id, source_id, document_id, document_version_id,
           extraction_id, subject_type, subject_id, extractor_id, extractor_version,
           chunking_strategy, chunking_version, visibility_scope, sensitivity_class,
           status, status_reason, invalidated_at, chunk_count, token_estimate)
        values (${input.tenantId}, ${input.ownerOrganisationId}, ${input.sourceId},
                ${input.documentId}, ${input.documentVersionId}, ${input.extractionId},
                ${input.subjectType}, ${input.subjectId}, ${input.extractorId},
                ${input.extractorVersion}, ${input.chunkingStrategy}, ${input.chunkingVersion},
                ${input.visibilityScope}, ${input.sensitivityClass}, ${input.status},
                ${input.statusReason},
                ${input.status === "ACTIVE" ? null : new Date()},
                ${input.chunkCount}, ${input.tokenEstimate})
        returning id`;
      const { id } = z.object({ id: ChunkSetIdSchema }).parse(rows[0]);
      const created = await findById(tx.sql, input.tenantId, id);
      if (created === null)
        throw new Error("chunk set insert did not return a row");
      return created;
    },
    findById,
    findByIdentity: async (
      executor,
      tenantId,
      documentVersionId,
      extractionId,
      chunkingVersion,
    ) => {
      const rows = await executor`
        ${selectChunkSets(executor)}
         where s.tenant_id = ${tenantId}
           and s.document_version_id = ${documentVersionId}
           and s.extraction_id = ${extractionId}
           and s.chunking_version = ${chunkingVersion}`;
      return rows.length === 0 ? null : toChunkSet(rows[0]);
    },
    listByDocument: async (executor, tenantId, documentId) => {
      const rows = await executor`
        ${selectChunkSets(executor)}
         where s.tenant_id = ${tenantId} and s.document_id = ${documentId}
         order by s.created_at, s.id`;
      return rows.map(toChunkSet);
    },
    listByVersion: async (executor, tenantId, documentVersionId) => {
      const rows = await executor`
        ${selectChunkSets(executor)}
         where s.tenant_id = ${tenantId} and s.document_version_id = ${documentVersionId}
         order by s.created_at, s.id`;
      return rows.map(toChunkSet);
    },
    listBySource: async (executor, tenantId, sourceId) => {
      const rows = await executor`
        ${selectChunkSets(executor)}
         where s.tenant_id = ${tenantId} and s.source_id = ${sourceId}
         order by s.created_at, s.id`;
      return rows.map(toChunkSet);
    },
    transition: async (tx, input) => {
      if (input.chunkSetIds.length === 0) return 0;
      const ids = [...input.chunkSetIds];
      const sets = await tx.sql`
        update q_knowledge.chunk_sets s
           set status = ${input.status},
               status_reason = ${input.reason},
               invalidated_at = coalesce(s.invalidated_at, now())
         where s.tenant_id = ${input.tenantId}
           and s.id = any(${ids}::uuid[])
           and s.status <> 'REVOKED'
           and s.status <> ${input.status}
        returning s.id`;
      const changed = z.array(z.object({ id: ChunkSetIdSchema })).parse(sets);
      if (changed.length === 0) return 0;
      const changedIds = changed.map((row) => row.id);
      await tx.sql`
        update q_knowledge.chunks c
           set status = ${input.status},
               invalidated_at = coalesce(c.invalidated_at, now())
         where c.tenant_id = ${input.tenantId}
           and c.chunk_set_id = any(${changedIds}::uuid[])
           and c.status <> 'REVOKED'
           and c.status <> ${input.status}`;
      return changed.length;
    },
  };
}

export function createPostgresChunkRepository(): ChunkRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into q_knowledge.chunks
          (tenant_id, chunk_set_id, document_version_id, subject_type, subject_id,
           parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256,
           token_estimate, block_index_start, block_index_end, locator,
           visibility_scope, sensitivity_class, instruction_risk_signals,
           status, invalidated_at)
        values (${input.tenantId}, ${input.chunkSetId}, ${input.documentVersionId},
                ${input.subjectType}, ${input.subjectId}, ${input.parentChunkId},
                ${input.chunkIndex}, ${input.role}, ${input.kind}, ${input.content},
                ${input.contentSha256}, ${input.tokenEstimate}, ${input.blockIndexStart},
                ${input.blockIndexEnd}, ${tx.sql.json(input.locator)}::jsonb,
                ${input.visibilityScope}, ${input.sensitivityClass},
                ${input.instructionRiskSignals}, ${input.status},
                ${input.status === "ACTIVE" ? null : new Date()})
        returning id`;
      const { id } = z.object({ id: ChunkIdSchema }).parse(rows[0]);
      const created = await tx.sql`
        ${selectChunks(tx.sql)}
         where c.tenant_id = ${input.tenantId} and c.id = ${id}`;
      if (created.length === 0)
        throw new Error("chunk insert did not return a row");
      return toChunk(created[0]);
    },
    listBySet: async (executor, tenantId, chunkSetId) => {
      const rows = await executor`
        ${selectChunks(executor)}
         where c.tenant_id = ${tenantId} and c.chunk_set_id = ${chunkSetId}
         order by c.chunk_index`;
      return rows.map(toChunk);
    },
    listActiveByVersion: async (executor, tenantId, documentVersionId) => {
      const rows = await executor`
        ${selectChunks(executor)}
         where c.tenant_id = ${tenantId}
           and c.document_version_id = ${documentVersionId}
           and c.status = 'ACTIVE'
         order by c.chunk_index`;
      return rows.map(toChunk);
    },
  };
}

export function createPostgresQKnowledgeRepositories(): QKnowledgeRepositories {
  return {
    chunkSets: createPostgresChunkSetRepository(),
    chunks: createPostgresChunkRepository(),
  };
}
