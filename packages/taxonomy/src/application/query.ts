import { DEFAULT_PAGE_SIZE } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";

import type {
  TaxonomyAlias,
  TaxonomyNode,
  TaxonomyNodeEdge,
  TaxonomyNodeId,
  TaxonomyNodeStatus,
  TaxonomyVersionSet,
  TaxonomyVocabulary,
  TaxonomyVocabularyCode,
} from "../contracts/index.js";
import {
  decodeTaxonomyNodeCursor,
  encodeTaxonomyNodeCursor,
} from "../domain/cursor.js";
import {
  TaxonomyNodeNotFoundError,
  TaxonomyVocabularyNotFoundError,
} from "../domain/errors.js";
import type { TaxonomyReferenceRepository } from "./ports.js";

/**
 * Reference reads every consumer shares: onboarding choices, future search
 * and classification, recommendations, Q tools. Reference taxonomy is
 * platform data, so no tenant or capability is consulted here; the HTTP
 * layer requires an authenticated context and tenant-owned assignments
 * live behind their own use cases.
 */

export type ListTaxonomyNodesInput = {
  readonly vocabularyCode: TaxonomyVocabularyCode;
  /** `null` lists roots; undefined lists any parent (paginated). */
  readonly parentNodeId?: TaxonomyNodeId | null | undefined;
  /** Defaults to ACTIVE so deprecated nodes are never offered by default. */
  readonly status?: TaxonomyNodeStatus | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
};

export type TaxonomyNodePage = {
  readonly items: readonly TaxonomyNode[];
  readonly nextCursor: string | undefined;
};

export type TaxonomyNodeDetail = {
  readonly node: TaxonomyNode;
  readonly ancestors: readonly TaxonomyNode[];
  readonly aliases: readonly TaxonomyAlias[];
  readonly edges: readonly TaxonomyNodeEdge[];
};

export type TaxonomyQueryPort = {
  readonly listVocabularies: () => Promise<readonly TaxonomyVocabulary[]>;
  readonly getVocabularyByCode: (
    code: TaxonomyVocabularyCode,
  ) => Promise<TaxonomyVocabulary>;
  readonly getNodeById: (nodeId: TaxonomyNodeId) => Promise<TaxonomyNode>;
  readonly findNodeById: (
    nodeId: TaxonomyNodeId,
  ) => Promise<TaxonomyNode | null>;
  readonly findNodeByCanonicalCode: (
    vocabularyCode: TaxonomyVocabularyCode,
    canonicalCode: string,
  ) => Promise<TaxonomyNode | null>;
  readonly getNodeDetail: (
    nodeId: TaxonomyNodeId,
  ) => Promise<TaxonomyNodeDetail>;
  readonly listNodes: (
    input: ListTaxonomyNodesInput,
  ) => Promise<TaxonomyNodePage>;
  readonly listChildren: (
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly listAncestors: (
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly listDescendants: (
    nodeId: TaxonomyNodeId,
    maxDepth?: number,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly listAliases: (
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyAlias[]>;
  readonly findNodesByAlias: (
    alias: string,
    locale?: string,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly getVersionSet: () => Promise<TaxonomyVersionSet>;
};

export const TAXONOMY_DESCENDANTS_MAX_DEPTH = 8;

export function createTaxonomyQueryPort(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly reference: TaxonomyReferenceRepository;
  readonly normalizeAlias: (alias: string) => string;
}): TaxonomyQueryPort {
  const { sql, reference, normalizeAlias } = dependencies;

  const getVocabularyByCode = async (code: TaxonomyVocabularyCode) => {
    const vocabulary = await reference.findVocabularyByCode(sql, code);
    if (vocabulary === null) {
      throw new TaxonomyVocabularyNotFoundError();
    }
    return vocabulary;
  };

  const getNodeById = async (nodeId: TaxonomyNodeId) => {
    const node = await reference.findNodeById(sql, nodeId);
    if (node === null) {
      throw new TaxonomyNodeNotFoundError();
    }
    return node;
  };

  return {
    listVocabularies: () => reference.listVocabularies(sql),
    getVocabularyByCode,
    getNodeById,
    findNodeById: (nodeId) => reference.findNodeById(sql, nodeId),
    findNodeByCanonicalCode: (vocabularyCode, canonicalCode) =>
      reference.findNodeByCanonicalCode(sql, vocabularyCode, canonicalCode),
    getNodeDetail: async (nodeId) => {
      const node = await getNodeById(nodeId);
      const [ancestors, aliases, edges] = await Promise.all([
        reference.listAncestors(sql, nodeId),
        reference.listAliases(sql, nodeId),
        reference.listEdges(sql, nodeId),
      ]);
      return { node, ancestors, aliases, edges };
    },
    listNodes: async (input) => {
      await getVocabularyByCode(input.vocabularyCode);
      const limit = input.limit ?? DEFAULT_PAGE_SIZE;
      const after =
        input.cursor === undefined
          ? undefined
          : decodeTaxonomyNodeCursor(input.cursor);
      const rows = await reference.listNodes(sql, input.vocabularyCode, {
        status: input.status ?? "ACTIVE",
        parentNodeId: input.parentNodeId,
        after,
        limit: limit + 1,
      });
      const items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const nextCursor =
        rows.length > limit && last !== undefined
          ? encodeTaxonomyNodeCursor({
              displayName: last.displayName,
              id: last.id,
            })
          : undefined;
      return { items, nextCursor };
    },
    listChildren: async (nodeId) => {
      const node = await getNodeById(nodeId);
      return reference.listNodes(sql, node.vocabularyCode, {
        status: "ACTIVE",
        parentNodeId: nodeId,
        limit: 500,
      });
    },
    listAncestors: (nodeId) => reference.listAncestors(sql, nodeId),
    listDescendants: (nodeId, maxDepth) =>
      reference.listDescendants(
        sql,
        nodeId,
        Math.min(
          maxDepth ?? TAXONOMY_DESCENDANTS_MAX_DEPTH,
          TAXONOMY_DESCENDANTS_MAX_DEPTH,
        ),
      ),
    listAliases: (nodeId) => reference.listAliases(sql, nodeId),
    findNodesByAlias: (alias, locale) =>
      reference.findNodesByNormalizedAlias(sql, normalizeAlias(alias), locale),
    getVersionSet: () => reference.getVersionSet(sql),
  };
}
