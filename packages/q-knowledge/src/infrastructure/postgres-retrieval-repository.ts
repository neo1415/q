import { z } from "zod";

import {
  MarketplaceVisibilitySchema,
  MessageSensitivitySchema,
  QKnowledgeScopeKindSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  ChunkIdSchema,
  ChunkKindSchema,
  ChunkLocatorSchema,
  ChunkRoleSchema,
  ChunkSetIdSchema,
  type ChunkId,
} from "../contracts/index.js";
import type { RetrievalScopeConstraint } from "../retrieval/contracts.js";
import type {
  AuthorisedCorpusScope,
  ChunkHydrationPort,
  HydratedChunk,
  LexicalCandidate,
  LexicalSearchPort,
} from "../retrieval/ports.js";

/**
 * The lexical half of hybrid retrieval, and authorised hydration
 * (CQ-RAG-004 §15-§19, §59, §100).
 *
 * The only file that speaks tsquery. Three properties hold in every
 * statement here and are the reason the file exists:
 *
 *   1. The security predicate is IN the query, above the ranking. Nothing
 *      is retrieved and then filtered, so an unauthorised chunk never
 *      exists as a row, a count, a timing difference or a bug away from
 *      being returned.
 *   2. The authorised disjunction is one bound jsonb parameter expanded by
 *      the database. The statement's shape never depends on the envelope,
 *      so no part of a permission check is ever assembled as text.
 *   3. The person's words reach `websearch_to_tsquery` as a bound
 *      parameter. Postgres parses them; nothing else does. Operator syntax
 *      a model or a browser sends is parsed as words, not as operators.
 */

/**
 * The envelope as the database reads it. `null` subject_ids means the
 * constraint is not narrowed by subject — only ever true for the actor-wide
 * network-visible and public scopes, never a wildcard over private material.
 */
function authorisedJson(
  constraints: readonly RetrievalScopeConstraint[],
): string {
  return JSON.stringify(
    constraints.map((constraint, at) => ({
      // The plan's own order, carried in the payload. Postgres refuses
      // WITH ORDINALITY on a function that takes a column definition list,
      // and the order matters: it decides which constraint a hit is
      // attributed to when more than one would admit it.
      position: at,
      scope_kind: constraint.scopeKind,
      subject_ids: constraint.subjectIds,
      visibility_scopes: constraint.visibilityScopes,
      sensitivity_ceiling: constraint.sensitivityCeiling,
      can_disclose_existence: constraint.canDiscloseExistence,
      can_quote: constraint.canQuote,
      can_provide_link: constraint.canProvideLink,
    })),
  );
}

const LexicalRow = z.object({
  chunk_id: ChunkIdSchema,
  lexical_score: z.union([z.number(), z.string()]).transform(Number),
});

/**
 * How a person's question becomes a tsquery.
 *
 * `websearch_to_tsquery` was the obvious choice and is the wrong one here:
 * it ANDs every term, so "What does the deck say about the total addressable
 * market?" requires a chunk containing "deck" and "say", and a real question
 * therefore matches nothing. Measured against the fixtures, it returned zero
 * lexical candidates for every natural-language question in the eval set.
 *
 * So the lexemes are ORed instead, and `ts_rank` orders by how many of them
 * a chunk matches. Initial retrieval optimises recall; precision comes from
 * fusion and from the final bound (doc 14 §27). Nothing about this accepts
 * operator syntax from a caller: Postgres parses the text into lexemes with
 * the same configuration the generated column used, `quote_literal` quotes
 * each one as tsquery's own literal, and a question made only of stop words
 * produces NULL — which matches nothing rather than everything.
 *
 * `english` is a literal in both places for the same reason: the column was
 * generated with it, and a query under another configuration would produce
 * lexemes that cannot match.
 */
export function createPostgresLexicalSearch(): LexicalSearchPort {
  return {
    search: async (executor, query) => {
      // An envelope with no constraints authorises nothing. Returning early
      // is not an optimisation: `exists (select from an empty set)` is false
      // for every row anyway, and going to the database to prove it would
      // make an unauthorised search indistinguishable in timing from an
      // authorised one that matched nothing.
      if (query.constraints.length === 0 || query.limit <= 0) {
        return [];
      }
      const authorised = authorisedJson(query.constraints);
      const rows = await executor`
        with q as (
          select nullif(
                   array_to_string(
                     array(
                       select quote_literal(lexeme)
                         from unnest(tsvector_to_array(to_tsvector('english', ${query.text})))
                           as lexeme
                     ), ' | '), '')::tsquery as query
        )
        select c.id as chunk_id,
               ts_rank(c.content_tsv, q.query) as lexical_score
          from q_knowledge.chunks c
         cross join q
         where q.query is not null
           and c.tenant_id = ${query.tenantId}
           and c.status = 'ACTIVE'
           and c.content_tsv @@ q.query
           and exists (
                 select 1
                   from jsonb_to_recordset(${authorised}::text::jsonb)
                     as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                  where (g.subject_ids is null or c.subject_id = any(g.subject_ids))
                    and c.visibility_scope = any(g.visibility_scopes)
                    and q_knowledge.sensitivity_rank(c.sensitivity_class)
                        <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
           and exists (
                 select 1
                   from q_knowledge.chunk_sets cs
                   join evidence.documents d
                     on d.id = cs.document_id and d.tenant_id = cs.tenant_id
                  where cs.id = c.chunk_set_id and cs.tenant_id = c.tenant_id
                    and cs.status = 'ACTIVE'
                    and d.status = 'ACTIVE'
                    and d.current_version_id = cs.document_version_id)
         order by lexical_score desc, c.id
         limit ${query.limit}`;
      return rows.map((row, at): LexicalCandidate => {
        const r = LexicalRow.parse(row);
        return {
          chunkId: r.chunk_id,
          rank: at + 1,
          lexicalScore: r.lexical_score,
        };
      });
    },
  };
}

const HydratedRow = z.object({
  chunk_id: ChunkIdSchema,
  chunk_set_id: ChunkSetIdSchema,
  document_id: z.string().uuid(),
  document_version_id: z.string().uuid(),
  document_title: z.string(),
  subject_type: z.literal("COMPANY"),
  subject_id: z.string().uuid(),
  chunk_kind: ChunkKindSchema,
  role: ChunkRoleSchema,
  locator: ChunkLocatorSchema,
  content: z.string(),
  visibility_scope: MarketplaceVisibilitySchema,
  sensitivity_class: MessageSensitivitySchema,
  parent_chunk_id: ChunkIdSchema.nullable(),
  scope_kind: QKnowledgeScopeKindSchema,
  can_disclose_existence: z.boolean(),
  can_quote: z.boolean(),
  can_provide_link: z.boolean(),
});

function toHydrated(row: unknown): HydratedChunk {
  const r = HydratedRow.parse(row);
  return {
    chunkId: r.chunk_id,
    chunkSetId: r.chunk_set_id,
    documentId: r.document_id,
    documentVersionId:
      r.document_version_id as HydratedChunk["documentVersionId"],
    documentTitle: r.document_title,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    chunkKind: r.chunk_kind,
    role: r.role,
    locator: r.locator,
    content: r.content,
    visibilityScope: r.visibility_scope,
    sensitivityClass: r.sensitivity_class,
    parentChunkId: r.parent_chunk_id,
    scopeKind: r.scope_kind,
    canDiscloseExistence: r.can_disclose_existence,
    canQuote: r.can_quote,
    canProvideLink: r.can_provide_link,
  };
}

/**
 * The join every hydration shares. `admitted_by` is a lateral over the
 * envelope that also decides WHICH constraint let a row through: the first
 * matching one, ordered as the plan ordered its scopes. That is what lets a
 * hit say why it was allowed without a second query and without the
 * application guessing.
 */
export function createPostgresChunkHydration(): ChunkHydrationPort {
  const rowsFor = async (
    executor: DatabaseExecutor,
    scope: AuthorisedCorpusScope,
    ids: readonly ChunkId[],
    mode: "SELF" | "PARENT",
  ): Promise<readonly { row: HydratedChunk; requestedFor: ChunkId }[]> => {
    if (scope.constraints.length === 0 || ids.length === 0) {
      return [];
    }
    const authorised = authorisedJson(scope.constraints);
    const requested = [...ids];
    const rows = await executor`
      with requested as (
        select id::uuid as requested_id, ordinality as position
          from unnest(${requested}::uuid[]) with ordinality as t(id, ordinality)
      ),
      target as (
        select r.requested_id,
               case when ${mode} = 'PARENT' then src.parent_chunk_id else src.id end as chunk_id
          from requested r
          join q_knowledge.chunks src
            on src.id = r.requested_id and src.tenant_id = ${scope.tenantId}
      )
      select t.requested_id,
             c.id as chunk_id, c.chunk_set_id, cs.document_id, c.document_version_id,
             d.title as document_title, c.subject_type, c.subject_id, c.chunk_kind,
             c.role, c.locator, c.content, c.visibility_scope, c.sensitivity_class,
             c.parent_chunk_id,
             admitted.scope_kind, admitted.can_disclose_existence,
             admitted.can_quote, admitted.can_provide_link
        from target t
        join q_knowledge.chunks c
          on c.id = t.chunk_id and c.tenant_id = ${scope.tenantId}
        join q_knowledge.chunk_sets cs
          on cs.id = c.chunk_set_id and cs.tenant_id = c.tenant_id
        join evidence.documents d
          on d.id = cs.document_id and d.tenant_id = cs.tenant_id
        cross join lateral (
          select g.scope_kind, g.can_disclose_existence, g.can_quote, g.can_provide_link
            from jsonb_to_recordset(${authorised}::text::jsonb)
              as g(position integer, scope_kind text, subject_ids uuid[],
                   visibility_scopes text[], sensitivity_ceiling text,
                   can_disclose_existence boolean, can_quote boolean,
                   can_provide_link boolean)
           where (g.subject_ids is null or c.subject_id = any(g.subject_ids))
             and c.visibility_scope = any(g.visibility_scopes)
             and q_knowledge.sensitivity_rank(c.sensitivity_class)
                 <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling)
           order by g.position
           limit 1
        ) as admitted
       where c.status = 'ACTIVE'
         and cs.status = 'ACTIVE'
         and d.status = 'ACTIVE'
         and d.current_version_id = cs.document_version_id`;
    return rows.map((row) => {
      const parsed = z.object({ requested_id: ChunkIdSchema }).parse(row);
      return { row: toHydrated(row), requestedFor: parsed.requested_id };
    });
  };

  return {
    hydrate: async (executor, query) => {
      const rows = await rowsFor(executor, query, query.chunkIds, "SELF");
      // Fused order is the caller's; the database returns a set.
      const byId = new Map(rows.map(({ row }) => [row.chunkId, row]));
      return query.chunkIds
        .map((id) => byId.get(id))
        .filter((row): row is HydratedChunk => row !== undefined);
    },

    countAuthorised: async (executor, scope) => {
      if (scope.constraints.length === 0 || scope.limit <= 0) {
        return 0;
      }
      const authorised = authorisedJson(scope.constraints);
      const rows = await executor<{ n: number }[]>`
        select count(*)::int as n
          from (
            select 1
              from q_knowledge.chunks c
              join q_knowledge.chunk_sets cs
                on cs.id = c.chunk_set_id and cs.tenant_id = c.tenant_id
              join evidence.documents d
                on d.id = cs.document_id and d.tenant_id = cs.tenant_id
             where c.tenant_id = ${scope.tenantId}
               and c.status = 'ACTIVE'
               and cs.status = 'ACTIVE'
               and d.status = 'ACTIVE'
               and d.current_version_id = cs.document_version_id
               and exists (
                     select 1
                       from jsonb_to_recordset(${authorised}::text::jsonb)
                         as g(subject_ids uuid[], visibility_scopes text[], sensitivity_ceiling text)
                      where (g.subject_ids is null or c.subject_id = any(g.subject_ids))
                        and c.visibility_scope = any(g.visibility_scopes)
                        and q_knowledge.sensitivity_rank(c.sensitivity_class)
                            <= q_knowledge.sensitivity_rank(g.sensitivity_ceiling))
             limit ${scope.limit}
          ) as capped`;
      return rows[0]?.n ?? 0;
    },

    parentsOf: async (executor, query) => {
      const rows = await rowsFor(executor, query, query.chunkIds, "PARENT");
      const byLeaf = new Map<ChunkId, HydratedChunk>();
      for (const { row, requestedFor } of rows) {
        byLeaf.set(requestedFor, row);
      }
      return byLeaf;
    },
  };
}
