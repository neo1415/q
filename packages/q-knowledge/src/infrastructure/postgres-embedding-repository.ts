import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { DocumentVersionIdSchema } from "@capital-q/evidence/contracts";
import { TenantIdSchema } from "@capital-q/security";

import type {
  ChunkEmbeddingRepository,
  SemanticSearchPort,
} from "../application/embedding-ports.js";
import {
  ChunkEmbeddingIdSchema,
  SemanticSearchScopeSchema,
  type SemanticCandidate,
  type StoredChunkEmbedding,
} from "../contracts/embeddings.js";
import {
  ChunkIdSchema,
  ChunkKindSchema,
  ChunkLocatorSchema,
  ChunkRoleSchema,
  ChunkSetIdSchema,
  type Chunk,
} from "../contracts/index.js";
import { toChunk } from "./postgres-chunk-repositories.js";

/**
 * The vector store in Postgres (CQ-RAG-003 §12, §35-§36).
 *
 * The only file that speaks pgvector. Vectors are bound as parameters and
 * cast, never interpolated into SQL; distances are computed with the cosine
 * operator the configuration declares; and the tenant predicate sits on the
 * same table the search orders by, so it constrains the scan rather than
 * filtering its output.
 *
 * No vector is ever selected back out. Nothing above this layer needs one,
 * and a vector that never leaves the database cannot be logged or serialised
 * by accident.
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

const EmbeddingRow = z.object({
  id: ChunkEmbeddingIdSchema,
  tenant_id: TenantIdSchema,
  chunk_id: ChunkIdSchema,
  provider_code: z.string(),
  model_code: z.string(),
  model_revision: z.string().nullable(),
  configuration_version: z.string(),
  instruction_version: z.string(),
  embedding_dimension: z.number().int(),
  created_at: Timestamp,
});

function toEmbedding(row: unknown): StoredChunkEmbedding {
  const r = EmbeddingRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    chunkId: r.chunk_id,
    providerCode: r.provider_code,
    modelCode: r.model_code,
    modelRevision: r.model_revision,
    configurationVersion: r.configuration_version,
    instructionVersion: r.instruction_version,
    dimension: r.embedding_dimension,
    createdAt: r.created_at,
  };
}

/** pgvector's text form. Built from validated finite numbers, bound as one parameter. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

function selectEmbeddings(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.chunk_id, e.provider_code, e.model_code,
           e.model_revision, e.configuration_version, e.instruction_version,
           e.embedding_dimension, e.created_at
      from q_knowledge.embeddings e`;
}

export function createPostgresChunkEmbeddingRepository(): ChunkEmbeddingRepository {
  const findByWorkIdentity: ChunkEmbeddingRepository["findByWorkIdentity"] =
    async (executor, tenantId, chunkId, identity) => {
      const rows = await executor`
        ${selectEmbeddings(executor)}
         where e.tenant_id = ${tenantId}
           and e.chunk_id = ${chunkId}
           and e.model_code = ${identity.modelCode}
           and e.embedding_dimension = ${identity.dimension}
           and e.configuration_version = ${identity.configurationVersion}
           and e.instruction_version = ${identity.instructionVersion}`;
      return rows.length === 0 ? null : toEmbedding(rows[0]);
    };

  return {
    findByWorkIdentity,

    upsert: async (tx, input) => {
      // The work identity is a unique constraint, so a concurrent duplicate
      // loses the race here rather than producing a second vector. DO NOTHING
      // keeps the first write authoritative: an embedding is never edited.
      const inserted = await tx.sql`
        insert into q_knowledge.embeddings
          (tenant_id, chunk_id, provider_code, model_code, model_revision,
           configuration_version, instruction_version, embedding_dimension, embedding)
        values (${input.tenantId}, ${input.chunkId}, ${input.providerCode},
                ${input.modelCode}, ${input.modelRevision},
                ${input.configurationVersion}, ${input.instructionVersion},
                ${input.dimension}, ${toVectorLiteral(input.vector)}::extensions.vector)
        on conflict (chunk_id, model_code, embedding_dimension, configuration_version, instruction_version)
          do nothing
        returning id`;
      const existing = await findByWorkIdentity(
        tx.sql,
        input.tenantId,
        input.chunkId,
        {
          providerCode: input.providerCode,
          modelCode: input.modelCode,
          modelRevision: input.modelRevision,
          configurationVersion: input.configurationVersion,
          instructionVersion: input.instructionVersion,
          dimension: input.dimension,
        },
      );
      if (existing === null) {
        throw new Error("embedding insert did not produce a row");
      }
      return { embedding: existing, created: inserted.length > 0 };
    },

    findById: async (executor, tenantId, id) => {
      const rows = await executor`
        ${selectEmbeddings(executor)}
         where e.tenant_id = ${tenantId} and e.id = ${id}`;
      return rows.length === 0 ? null : toEmbedding(rows[0]);
    },

    listByChunk: async (executor, tenantId, chunkId) => {
      const rows = await executor`
        ${selectEmbeddings(executor)}
         where e.tenant_id = ${tenantId} and e.chunk_id = ${chunkId}
         order by e.created_at, e.id`;
      return rows.map(toEmbedding);
    },

    listChunksMissingEmbedding: async (executor, query) => {
      // Only ACTIVE chunks are worth embedding: spending on a vector for a
      // superseded or revoked chunk buys nothing that may ever be retrieved.
      const rows = await executor`
        select c.id, c.tenant_id, c.chunk_set_id, c.document_version_id, c.subject_type,
               c.subject_id, c.parent_chunk_id, c.chunk_index, c.role, c.chunk_kind,
               c.content, c.content_sha256, c.token_estimate, c.block_index_start,
               c.block_index_end, c.locator, c.visibility_scope, c.sensitivity_class,
               c.instruction_risk_signals, c.status, c.invalidated_at, c.created_at
          from q_knowledge.chunks c
         where c.status = 'ACTIVE'
           and (${query.tenantId ?? null}::uuid is null or c.tenant_id = ${query.tenantId ?? null})
           and not exists (
             select 1 from q_knowledge.embeddings e
              where e.chunk_id = c.id
                and e.configuration_version = ${query.configurationVersion})
         order by c.created_at, c.id
         limit ${query.limit}`;
      return rows.map((row): Chunk => toChunk(row));
    },

    countByConfiguration: async (executor, tenantId, configurationVersion) => {
      const rows = await executor<{ n: number }[]>`
        select count(*)::int as n
          from q_knowledge.embeddings e
         where e.tenant_id = ${tenantId}
           and e.configuration_version = ${configurationVersion}`;
      return rows[0]?.n ?? 0;
    },
  };
}

const CandidateRow = z.object({
  chunk_id: ChunkIdSchema,
  chunk_set_id: ChunkSetIdSchema,
  document_version_id: DocumentVersionIdSchema,
  subject_type: z.literal("COMPANY"),
  subject_id: z.string().uuid(),
  chunk_kind: ChunkKindSchema,
  role: ChunkRoleSchema,
  locator: ChunkLocatorSchema,
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  content: z.string(),
  distance: z.union([z.number(), z.string()]).transform(Number),
  configuration_version: z.string(),
  model_code: z.string(),
});

export function createPostgresSemanticSearch(): SemanticSearchPort {
  return {
    search: async (executor, rawScope) => {
      const scope = SemanticSearchScopeSchema.parse(rawScope);
      // Absent means "not narrowed by this axis" and is expressed as a NULL
      // parameter rather than an omitted SQL fragment, so the statement is
      // one fixed, parameterised shape whatever the caller passes.
      const subjects = scope.subjectIds ?? null;
      const scopes = scope.allowedVisibilityScopes ?? null;
      // The authorised disjunction travels as ONE jsonb parameter and is
      // expanded by the database, so the statement keeps a single fixed
      // shape however many constraints the envelope carries, and no part of
      // a security predicate is ever built by string concatenation.
      const authorised =
        scope.authorisedScopes === undefined
          ? null
          : JSON.stringify(
              scope.authorisedScopes.map((constraint) => ({
                subject_ids: constraint.subjectIds,
                visibility_scopes: constraint.visibilityScopes,
                sensitivity_ceiling: constraint.sensitivityCeiling,
              })),
            );
      const requireCurrentSource = scope.requireCurrentSource ?? false;
      const rows = await executor`
        select c.id as chunk_id, c.chunk_set_id, c.document_version_id, c.subject_type,
               c.subject_id, c.chunk_kind, c.role, c.locator, c.visibility_scope,
               c.sensitivity_class, c.content, e.configuration_version, e.model_code,
               (e.embedding <=> ${toVectorLiteral(scope.queryVector)}::extensions.vector) as distance
          from q_knowledge.embeddings e
          join q_knowledge.chunks c
            on c.id = e.chunk_id and c.tenant_id = e.tenant_id
         where e.tenant_id = ${scope.tenantId}
           and e.configuration_version = ${scope.configurationVersion}
           -- Eligibility is the chunk's, never the vector's: a revoked or
           -- superseded chunk cannot return through its embedding.
           and c.status = 'ACTIVE'
           and (${subjects}::uuid[] is null or c.subject_id = any(${subjects}::uuid[]))
           and (${scopes}::text[] is null or c.visibility_scope = any(${scopes}::text[]))
           and (${authorised}::text::jsonb is null or exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or c.subject_id = any(g.subject_ids))
                    and c.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(c.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling)))
           and (${requireCurrentSource} = false or exists (
                 select 1
                   from q_knowledge.chunk_sets cs
                   join evidence.documents d
                     on d.id = cs.document_id and d.tenant_id = cs.tenant_id
                  where cs.id = c.chunk_set_id and cs.tenant_id = c.tenant_id
                    and cs.status = 'ACTIVE'
                    and d.status = 'ACTIVE'
                    and d.current_version_id = cs.document_version_id))
         order by distance
         limit ${scope.k}`;
      return rows.map((row, at): SemanticCandidate => {
        const r = CandidateRow.parse(row);
        return {
          chunkId: r.chunk_id,
          chunkSetId: r.chunk_set_id,
          documentVersionId: r.document_version_id,
          subjectType: r.subject_type,
          subjectId: r.subject_id,
          chunkKind: r.chunk_kind,
          role: r.role,
          locator: r.locator,
          visibilityScope: r.visibility_scope,
          sensitivityClass: r.sensitivity_class,
          content: r.content,
          distance: r.distance,
          similarity: 1 - r.distance,
          rank: at + 1,
          configurationVersion: r.configuration_version,
          modelCode: r.model_code,
        };
      });
    },
  };
}
