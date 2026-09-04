import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  TaxonomyCanonicalCodeSchema,
  TaxonomyNodeIdSchema,
  TaxonomyNodeMetadataSchema,
  TaxonomyNodeStatusSchema,
  TaxonomyVocabularyCodeSchema,
  TaxonomyVocabularyIdSchema,
  type TaxonomyNode,
} from "../../contracts/index.js";
import type {
  LexicalSearchHit,
  TaxonomyLexicalSearchRepository,
} from "../application/ports.js";

/**
 * PostgreSQL lexical retrieval using pg_trgm (installed by the CQ-TAX-002
 * migration in the `extensions` schema, so every call is schema-qualified).
 *
 * The query text and its tokens are bound parameters. Retrieval predicate:
 * token overlap (exact token equality via array overlap) OR
 * word_similarity(candidate, query) at or above the floor. Candidate text
 * is server data (display names, code words, curated aliases); user input
 * is never interpolated into a pattern, tsquery or regex.
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

const HitRow = z.object({
  id: TaxonomyNodeIdSchema,
  vocabulary_id: TaxonomyVocabularyIdSchema,
  vocabulary_code: TaxonomyVocabularyCodeSchema,
  canonical_code: TaxonomyCanonicalCodeSchema,
  display_name: z.string(),
  description: z.string().nullable(),
  parent_node_id: TaxonomyNodeIdSchema.nullable(),
  depth: z.number().int().min(0),
  status: TaxonomyNodeStatusSchema,
  valid_from: Timestamp.nullable(),
  valid_to: Timestamp.nullable(),
  metadata: TaxonomyNodeMetadataSchema,
  field: z.enum(["canonical_code", "display_name", "alias"]),
  candidate_text: z.string(),
  word_similarity: z.coerce.number(),
});

function toNode(r: z.infer<typeof HitRow>): TaxonomyNode {
  return {
    id: r.id,
    vocabularyId: r.vocabulary_id,
    vocabularyCode: r.vocabulary_code,
    canonicalCode: r.canonical_code,
    displayName: r.display_name,
    description: r.description,
    parentNodeId: r.parent_node_id,
    depth: r.depth,
    status: r.status,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    metadata: r.metadata,
  };
}

function toHit(row: unknown): LexicalSearchHit {
  const r = HitRow.parse(row);
  return {
    node: toNode(r),
    field: r.field,
    text: r.candidate_text,
    wordSimilarity: r.word_similarity,
  };
}

export function createPostgresTaxonomyLexicalSearchRepository(): TaxonomyLexicalSearchRepository {
  const nodeColumns = (executor: DatabaseExecutor) => executor`
    n.id, n.vocabulary_id, v.code as vocabulary_code, n.canonical_code, n.display_name,
    n.description, n.parent_node_id, n.depth, n.status, n.valid_from, n.valid_to, n.metadata`;

  return {
    search: async (executor, query) => {
      const codes = [...query.vocabularyCodes];
      const tokens = [...query.tokens];
      const rows = await executor`
        with q as (
          select ${query.normalizedText}::text as text, ${tokens}::text[] as tokens
        ),
        texts as (
          select n.id as node_id, 'display_name'::text as field,
                 lower(btrim(n.display_name)) as candidate_text
            from taxonomy.nodes n
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = any(${codes}::text[]) and v.status = 'ACTIVE' and n.status = 'ACTIVE'
          union all
          select n.id, 'canonical_code', replace(replace(n.canonical_code, '_', ' '), '.', ' ')
            from taxonomy.nodes n
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = any(${codes}::text[]) and v.status = 'ACTIVE' and n.status = 'ACTIVE'
          union all
          select a.node_id, 'alias', a.normalized_alias
            from taxonomy.aliases a
            join taxonomy.nodes n on n.id = a.node_id
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = any(${codes}::text[]) and v.status = 'ACTIVE' and n.status = 'ACTIVE'
        ),
        scored as (
          select t.node_id, t.field, t.candidate_text,
                 extensions.word_similarity(t.candidate_text, q.text) as word_similarity
            from texts t, q
           where string_to_array(t.candidate_text, ' ') && q.tokens
              or (length(t.candidate_text) >= ${query.similarityMinCandidateLength}
                  and extensions.word_similarity(t.candidate_text, q.text) >= ${query.similarityFloor}::float4)
        )
        select ${nodeColumns(executor)}, s.field, s.candidate_text, s.word_similarity
          from scored s
          join taxonomy.nodes n on n.id = s.node_id
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         order by s.word_similarity desc, v.code, n.canonical_code, s.field
         limit ${query.rowLimit}`;
      return rows.map(toHit);
    },
    findByNormalizedDisplayName: async (
      executor,
      normalizedDisplayName,
      vocabularyCodes,
    ) => {
      const codes = [...vocabularyCodes];
      const rows = await executor`
        select ${nodeColumns(executor)}, 'display_name'::text as field,
               lower(btrim(n.display_name)) as candidate_text, 1::float4 as word_similarity
          from taxonomy.nodes n
          join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = any(${codes}::text[])
           and lower(btrim(n.display_name)) = ${normalizedDisplayName}
         order by v.code, n.canonical_code`;
      return rows.map((row) => toHit(row).node);
    },
  };
}
