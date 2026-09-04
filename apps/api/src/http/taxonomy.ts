import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ListTaxonomyNodesQuerySchema,
  ListTaxonomyNodesResponseSchema,
  ListTaxonomyVocabulariesResponseSchema,
  parseContract,
  TAXONOMY_NODES_SEGMENT,
  TAXONOMY_PATH,
  TAXONOMY_VOCABULARIES_SEGMENT,
  TaxonomyNodeDetailDtoSchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyVocabularyCode,
} from "@capital-q/contracts";
import {
  TaxonomyNodeIdSchema,
  toTaxonomyNodeDetailDto,
  toTaxonomyNodeDto,
  toTaxonomyVocabularyDto,
  type TaxonomyNodeId,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import {
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/taxonomy` -- read-only reference taxonomy for authenticated Capital Q
 * users (onboarding choices, later search and discovery). No assignment,
 * classification, search or editing route exists here: assignments are
 * written by owning product workflows, classification is CQ-TAX-002 and
 * the platform taxonomy changes by reviewed migration.
 */

export type TaxonomyRoutesDependencies = ActorContextDependencies & {
  readonly taxonomy: TaxonomyQueryPort;
};

function vocabularyCodeParam(request: FastifyRequest): TaxonomyVocabularyCode {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    TaxonomyVocabularyCodeSchema,
    params["vocabularyCode"],
    "The vocabulary code is not valid.",
  );
}

function nodeIdParam(request: FastifyRequest): TaxonomyNodeId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    TaxonomyNodeIdSchema,
    params["nodeId"],
    "The taxonomy node identifier is not valid.",
  );
}

export function registerTaxonomyRoutes(
  app: FastifyInstance,
  dependencies: TaxonomyRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const query = dependencies.taxonomy;
  const vocabularies = `${TAXONOMY_PATH}${TAXONOMY_VOCABULARIES_SEGMENT}`;

  app.get(vocabularies, { onRequest: withContext }, async () => {
    const items = await query.listVocabularies();
    return ListTaxonomyVocabulariesResponseSchema.parse({
      items: items.map(toTaxonomyVocabularyDto),
    });
  });

  app.get(
    `${vocabularies}/:vocabularyCode${TAXONOMY_NODES_SEGMENT}`,
    { onRequest: withContext },
    async (request) => {
      const vocabularyCode = vocabularyCodeParam(request);
      const params = parseContract(
        ListTaxonomyNodesQuerySchema,
        request.query,
        "The node list query is not valid.",
      );
      const page = await query.listNodes({
        vocabularyCode,
        parentNodeId:
          params.roots === "true"
            ? null
            : params.parentNodeId === undefined
              ? undefined
              : TaxonomyNodeIdSchema.parse(params.parentNodeId),
        status: params.status,
        cursor: params.cursor,
        limit: params.limit,
      });
      return ListTaxonomyNodesResponseSchema.parse({
        items: page.items.map(toTaxonomyNodeDto),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      });
    },
  );

  app.get(
    `${TAXONOMY_PATH}${TAXONOMY_NODES_SEGMENT}/:nodeId`,
    { onRequest: withContext },
    async (request) => {
      const detail = await query.getNodeDetail(nodeIdParam(request));
      return TaxonomyNodeDetailDtoSchema.parse(
        toTaxonomyNodeDetailDto(detail.node, detail.ancestors, detail.aliases),
      );
    },
  );
}
