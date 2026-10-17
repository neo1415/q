import type {
  FastifyInstance,
  FastifyRequest,
  onRequestHookHandler,
} from "fastify";
import { ActorContextRequiredError } from "@capital-q/security";
import {
  ListTaxonomyNodesQuerySchema,
  ListTaxonomyNodesResponseSchema,
  ListTaxonomyVocabulariesResponseSchema,
  parseContract,
  TAXONOMY_CANDIDATES_SEGMENT,
  TAXONOMY_NODES_SEGMENT,
  TAXONOMY_PATH,
  TAXONOMY_VOCABULARIES_SEGMENT,
  TaxonomyCandidateRequestSchema,
  TaxonomyCandidateResponseSchema,
  TaxonomyNodeDetailDtoSchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyVocabularyCode,
} from "@capital-q/contracts";
import {
  TaxonomyNodeIdSchema,
  toTaxonomyNodeDetailDto,
  toTaxonomyNodeDto,
  toTaxonomyVocabularyDto,
  type TaxonomyCandidateFinder,
  type TaxonomyNodeId,
  type TaxonomyQueryPort,
} from "@capital-q/taxonomy";

import {
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";
import {
  requireOnboardingActorHook,
  type OnboardingActorDependencies,
} from "../security/onboarding-actor.js";

/**
 * `/v1/taxonomy` -- reference taxonomy reads and the stateless candidate
 * lookup for authenticated Capital Q users. `POST /candidates` computes
 * deterministic canonical-node candidates and persists nothing; there is
 * no assignment, classification-run, alias or editing route here:
 * assignments and provenance runs belong to owning product workflows, and
 * the platform taxonomy changes by reviewed migration.
 */

export type TaxonomyRoutesDependencies = ActorContextDependencies & {
  readonly taxonomy: {
    readonly query: TaxonomyQueryPort;
    readonly candidates: TaxonomyCandidateFinder;
  };
  /**
   * With it, a signed-in person reads the vocabulary before they belong
   * to an organisation (live AJ/AM 2026-10-16: a new investor's first
   * answer named their sectors, the look-ups were refused 400 for want of
   * an organisation, and the categories needed another round). The
   * taxonomy is shared reference data with no tenant rows; the person is
   * still authenticated and must have an application identity.
   */
  readonly identities?: OnboardingActorDependencies["identities"] | undefined;
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
  const withOrganisation = requireActorContextHook(dependencies);
  const identities = dependencies.identities;
  const withPerson =
    identities === undefined
      ? undefined
      : requireOnboardingActorHook({
          authenticator: dependencies.authenticator,
          resolver: dependencies.resolver,
          identities,
        });
  // An organisation context as before; when the person has none yet (a
  // new investor mid-way through their first answer), their own signed-in
  // identity, checked by the onboarding actor hook.
  const withContext: onRequestHookHandler =
    withPerson === undefined
      ? withOrganisation
      : function taxonomyReaderHook(request, reply, done) {
          withOrganisation.call(this, request, reply, (error?: Error) => {
            if (error instanceof ActorContextRequiredError) {
              withPerson.call(this, request, reply, done);
              return;
            }
            done(error);
          });
        };
  const { query, candidates } = dependencies.taxonomy;
  const vocabularies = `${TAXONOMY_PATH}${TAXONOMY_VOCABULARIES_SEGMENT}`;

  // Read/compute only. The body is validated and handed to the classifier;
  // it is never logged, stored or echoed. No classification run is created.
  app.post(
    `${TAXONOMY_PATH}${TAXONOMY_CANDIDATES_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const input = parseContract(
        TaxonomyCandidateRequestSchema,
        request.body,
        "The candidate request is not valid.",
      );
      const result = await candidates.findCandidates(input);
      void reply.header("Cache-Control", "no-store");
      return TaxonomyCandidateResponseSchema.parse(result);
    },
  );

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
