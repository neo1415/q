import {
  ListTaxonomyNodesResponseSchema,
  ListTaxonomyVocabulariesResponseSchema,
  TAXONOMY_NODES_SEGMENT,
  TAXONOMY_PATH,
  TAXONOMY_VOCABULARIES_SEGMENT,
  TaxonomyNodeDetailDtoSchema,
  type TaxonomyNodeStatus,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** `GET /v1/taxonomy/vocabularies` -- the active vocabularies. */
export function listTaxonomyVocabularies(session: ApiSession) {
  return call(
    session,
    "GET",
    `${TAXONOMY_PATH}${TAXONOMY_VOCABULARIES_SEGMENT}`,
    ListTaxonomyVocabulariesResponseSchema,
  );
}

/**
 * `GET /v1/taxonomy/vocabularies/:code/nodes` -- roots, direct children or
 * a page of the vocabulary. Deprecated nodes are excluded unless asked for.
 */
export function listTaxonomyNodes(
  session: ApiSession,
  vocabularyCode: string,
  page: {
    readonly roots?: boolean | undefined;
    readonly parentNodeId?: string | undefined;
    readonly status?: TaxonomyNodeStatus | undefined;
    readonly cursor?: string | undefined;
    readonly limit?: number | undefined;
  } = {},
) {
  const query = new URLSearchParams();
  if (page.roots === true) {
    query.set("roots", "true");
  }
  if (page.parentNodeId !== undefined) {
    query.set("parentNodeId", page.parentNodeId);
  }
  if (page.status !== undefined) {
    query.set("status", page.status);
  }
  if (page.cursor !== undefined) {
    query.set("cursor", page.cursor);
  }
  if (page.limit !== undefined) {
    query.set("limit", String(page.limit));
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    `${TAXONOMY_PATH}${TAXONOMY_VOCABULARIES_SEGMENT}/${encodeURIComponent(vocabularyCode)}${TAXONOMY_NODES_SEGMENT}${suffix}`,
    ListTaxonomyNodesResponseSchema,
  );
}

/** `GET /v1/taxonomy/nodes/:nodeId` -- one node with its ancestry and aliases. */
export function getTaxonomyNode(session: ApiSession, nodeId: string) {
  return call(
    session,
    "GET",
    `${TAXONOMY_PATH}${TAXONOMY_NODES_SEGMENT}/${encodeURIComponent(nodeId)}`,
    TaxonomyNodeDetailDtoSchema,
  );
}
