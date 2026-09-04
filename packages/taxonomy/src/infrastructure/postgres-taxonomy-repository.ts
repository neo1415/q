import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import {
  TaxonomyAliasIdSchema,
  TaxonomyAliasTypeSchema,
  TaxonomyCanonicalCodeSchema,
  TaxonomyEdgeTypeSchema,
  TaxonomyNodeIdSchema,
  TaxonomyNodeMetadataSchema,
  TaxonomyNodeStatusSchema,
  TaxonomyVocabularyCodeSchema,
  TaxonomyVocabularyIdSchema,
  TaxonomyVocabularyStatusSchema,
  type TaxonomyAlias,
  type TaxonomyNode,
  type TaxonomyNodeEdge,
  type TaxonomyVocabulary,
} from "../contracts/index.js";
import { TAXONOMY_MAX_DEPTH } from "../domain/hierarchy.js";
import type { TaxonomyReferenceRepository } from "../application/ports.js";

/**
 * PostgreSQL adapter for reference taxonomy reads. Parameterised SQL only:
 * vocabulary codes, canonical codes and aliases are always bound as data.
 * Reference tables are server-internal; this adapter runs under the
 * application's trusted connection. Read-only by construction: platform
 * taxonomy changes arrive through reviewed migrations, never at runtime.
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

const VocabularyRow = z.object({
  id: TaxonomyVocabularyIdSchema,
  code: TaxonomyVocabularyCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().min(1),
  status: TaxonomyVocabularyStatusSchema,
  created_at: Timestamp,
});

function toVocabulary(row: unknown): TaxonomyVocabulary {
  const r = VocabularyRow.parse(row);
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    version: r.version,
    status: r.status,
    createdAt: r.created_at,
  };
}

const NodeRow = z.object({
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
});

function toNode(row: unknown): TaxonomyNode {
  const r = NodeRow.parse(row);
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

function nodeSelect(executor: DatabaseExecutor) {
  return executor`
    select n.id, n.vocabulary_id, v.code as vocabulary_code, n.canonical_code, n.display_name,
           n.description, n.parent_node_id, n.depth, n.status, n.valid_from, n.valid_to, n.metadata
      from taxonomy.nodes n
      join taxonomy.vocabularies v on v.id = n.vocabulary_id`;
}

const AliasRow = z.object({
  id: TaxonomyAliasIdSchema,
  node_id: TaxonomyNodeIdSchema,
  alias: z.string(),
  locale: z.string(),
  alias_type: TaxonomyAliasTypeSchema,
  normalized_alias: z.string(),
});

function toAlias(row: unknown): TaxonomyAlias {
  const r = AliasRow.parse(row);
  return {
    id: r.id,
    nodeId: r.node_id,
    alias: r.alias,
    locale: r.locale,
    aliasType: r.alias_type,
    normalizedAlias: r.normalized_alias,
  };
}

const EdgeRow = z.object({
  from_node_id: TaxonomyNodeIdSchema,
  to_node_id: TaxonomyNodeIdSchema,
  edge_type: TaxonomyEdgeTypeSchema,
});

function toEdge(row: unknown): TaxonomyNodeEdge {
  const r = EdgeRow.parse(row);
  return {
    fromNodeId: r.from_node_id,
    toNodeId: r.to_node_id,
    edgeType: r.edge_type,
  };
}

export function createPostgresTaxonomyReferenceRepository(): TaxonomyReferenceRepository {
  return {
    listVocabularies: async (executor) => {
      const rows = await executor`
        select v.id, v.code, v.name, v.description, v.version, v.status, v.created_at
          from taxonomy.vocabularies v
         where v.status = 'ACTIVE'
         order by v.code`;
      return rows.map(toVocabulary);
    },
    findVocabularyByCode: async (executor, code) => {
      const rows = await executor`
        select v.id, v.code, v.name, v.description, v.version, v.status, v.created_at
          from taxonomy.vocabularies v
         where v.code = ${code}`;
      return rows.length === 0 ? null : toVocabulary(rows[0]);
    },
    findNodeById: async (executor, nodeId) => {
      const rows = await executor`
        ${nodeSelect(executor)} where n.id = ${nodeId}`;
      return rows.length === 0 ? null : toNode(rows[0]);
    },
    findNodesByIds: async (executor, nodeIds) => {
      if (nodeIds.length === 0) {
        return [];
      }
      const rows = await executor`
        ${nodeSelect(executor)} where n.id = any(${[...nodeIds]}::uuid[])`;
      return rows.map(toNode);
    },
    findNodeByCanonicalCode: async (
      executor,
      vocabularyCode,
      canonicalCode,
    ) => {
      const rows = await executor`
        ${nodeSelect(executor)}
         where v.code = ${vocabularyCode} and n.canonical_code = ${canonicalCode}`;
      return rows.length === 0 ? null : toNode(rows[0]);
    },
    listNodes: async (executor, vocabularyCode, page) => {
      // Keyset on (display_name, id). `parentNodeId` null = roots; undefined = any.
      const parentFilter =
        page.parentNodeId === undefined
          ? "any"
          : page.parentNodeId === null
            ? "roots"
            : "children";
      const rows = await executor`
        ${nodeSelect(executor)}
         where v.code = ${vocabularyCode}
           and (${page.status ?? null}::text is null or n.status = ${page.status ?? null})
           and (
                 ${parentFilter} = 'any'
              or (${parentFilter} = 'roots' and n.parent_node_id is null)
              or (${parentFilter} = 'children' and n.parent_node_id = ${page.parentNodeId ?? null}::uuid)
           )
           and (${page.after?.displayName ?? null}::text is null
                or (n.display_name, n.id) > (${page.after?.displayName ?? null}::text, ${page.after?.id ?? null}::uuid))
         order by n.display_name, n.id
         limit ${page.limit}`;
      return rows.map(toNode);
    },
    listAncestors: async (executor, nodeId) => {
      const rows = await executor`
        with recursive chain as (
          select n.*, 0 as steps
            from taxonomy.nodes n
           where n.id = ${nodeId}
          union all
          select p.*, chain.steps + 1
            from taxonomy.nodes p
            join chain on chain.parent_node_id = p.id
           where chain.steps < ${TAXONOMY_MAX_DEPTH}
        )
        select c.id, c.vocabulary_id, v.code as vocabulary_code, c.canonical_code, c.display_name,
               c.description, c.parent_node_id, c.depth, c.status, c.valid_from, c.valid_to, c.metadata
          from chain c
          join taxonomy.vocabularies v on v.id = c.vocabulary_id
         where c.id <> ${nodeId}
         order by c.depth`;
      return rows.map(toNode);
    },
    listDescendants: async (executor, nodeId, maxDepth) => {
      const rows = await executor`
        with recursive tree as (
          select n.*, 0 as steps
            from taxonomy.nodes n
           where n.id = ${nodeId}
          union all
          select c.*, tree.steps + 1
            from taxonomy.nodes c
            join tree on c.parent_node_id = tree.id
           where tree.steps < ${maxDepth}
        )
        select t.id, t.vocabulary_id, v.code as vocabulary_code, t.canonical_code, t.display_name,
               t.description, t.parent_node_id, t.depth, t.status, t.valid_from, t.valid_to, t.metadata
          from tree t
          join taxonomy.vocabularies v on v.id = t.vocabulary_id
         where t.id <> ${nodeId}
         order by t.depth, t.display_name, t.id`;
      return rows.map(toNode);
    },
    listAliases: async (executor, nodeId) => {
      const rows = await executor`
        select a.id, a.node_id, a.alias, a.locale, a.alias_type, a.normalized_alias
          from taxonomy.aliases a
         where a.node_id = ${nodeId}
         order by a.locale, a.normalized_alias`;
      return rows.map(toAlias);
    },
    findNodesByNormalizedAlias: async (executor, normalizedAlias, locale) => {
      const rows = await executor`
        ${nodeSelect(executor)}
          join taxonomy.aliases a on a.node_id = n.id
         where a.normalized_alias = ${normalizedAlias}
           and (${locale ?? null}::text is null or a.locale = ${locale ?? null})
         order by v.code, n.canonical_code`;
      return rows.map(toNode);
    },
    listEdges: async (executor, nodeId) => {
      const rows = await executor`
        select e.from_node_id, e.to_node_id, e.edge_type
          from taxonomy.node_edges e
         where e.from_node_id = ${nodeId} or e.to_node_id = ${nodeId}
         order by e.edge_type, e.from_node_id, e.to_node_id`;
      return rows.map(toEdge);
    },
    getVersionSet: async (executor) => {
      const rows = await executor`
        select v.code, v.version from taxonomy.vocabularies v where v.status = 'ACTIVE' order by v.code`;
      const set: Record<string, number> = {};
      for (const raw of rows) {
        const row = z
          .object({
            code: TaxonomyVocabularyCodeSchema,
            version: z.number().int(),
          })
          .parse(raw);
        set[row.code] = row.version;
      }
      return set;
    },
  };
}
