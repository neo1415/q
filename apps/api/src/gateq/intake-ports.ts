import type { DatabaseExecutor } from "@capital-q/database";
import {
  GatewayIdSchema,
  GatewayPublicIdSchema,
  GatewayVersionIdSchema,
  type GatewayPolicy,
  type GatewayRepository,
  type GatewayVersionRepository,
} from "@capital-q/gateq";
import type {
  BoundPolicyPort,
  TaxonomyResolutionPort,
} from "@capital-q/gateq-intake";
import {
  TaxonomyNodeIdSchema,
  type TaxonomyReferenceRepository,
} from "@capital-q/taxonomy";

/**
 * What intake borrows from the contexts around it (CQ-GATE-002R §8).
 *
 * Wired here rather than inside `@capital-q/gateq-intake` for the same
 * reason the company projection is: intake owns applications, and a
 * package that reached into GateQ's and Taxonomy's stores to get its work
 * done would own them too. The app is where contexts meet.
 */

/**
 * The policy an application is judged under.
 *
 * Two different questions, deliberately kept apart. A brand-new
 * application asks what is published *now*, and is frozen to it. An
 * application already in progress asks for the exact version it was bound
 * to when it started — which may no longer be the published one, and that
 * is the point: an investor who tightens their criteria on Tuesday does
 * not retroactively reject the founder who started on Monday.
 */
export function createIntakeBoundPolicyPort(dependencies: {
  readonly gateways: GatewayRepository;
  readonly versions: GatewayVersionRepository;
}): BoundPolicyPort {
  const { gateways, versions } = dependencies;

  return {
    policyByVersionId: async (input) => {
      const gatewayId = GatewayIdSchema.safeParse(input.gatewayId);
      const versionId = GatewayVersionIdSchema.safeParse(
        input.gatewayVersionId,
      );
      if (!gatewayId.success || !versionId.success) return null;

      const gateway = await gateways.findById(gatewayId.data);
      if (gateway === null) return null;
      const version = await versions.findById(versionId.data);
      // The version must belong to the gateway the application names. A
      // mismatch is a caller mixing two applications, not a lookup miss.
      if (version === null || version.gatewayId !== gateway.id) return null;
      const criteria = await versions.criteriaFor(version.id);
      return { gateway, version, criteria: [...criteria] };
    },

    currentPolicyByPublicId: async (publicId) => {
      const parsed = GatewayPublicIdSchema.safeParse(publicId);
      if (!parsed.success) return null;
      const gateway = await gateways.findByPublicId(parsed.data);
      if (gateway === null) return null;
      const version = await versions.findPublished(gateway.id);
      if (version === null) return null;
      const criteria = await versions.criteriaFor(version.id);
      const policy: GatewayPolicy = {
        gateway,
        version,
        criteria: [...criteria],
      };
      return policy;
    },
  };
}

/**
 * The applicant's words, resolved against the canonical hierarchy.
 *
 * A model never produces a node id. It produces the phrases the founder
 * used, and Taxonomy says what those mean — so "we do payments for
 * merchants" can match an investor who wrote "fintech" through the
 * hierarchy rather than through a string comparison.
 *
 * Ambiguity is preserved rather than resolved. More than one plausible
 * node comes back as `unambiguous: false`, which intake treats as
 * something to ask the applicant about, not as a classification. Guessing
 * here would turn a founder's sentence into a fact nobody ever confirmed.
 */
export function createIntakeTaxonomyPort(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly candidates: {
    readonly findCandidates: (input: {
      readonly text: string;
      readonly limit?: number | undefined;
    }) => Promise<{
      readonly candidates: readonly {
        readonly nodeId: unknown;
        readonly vocabularyCode: unknown;
        readonly matchTypes: readonly string[];
      }[];
    }>;
  };
  readonly reference: TaxonomyReferenceRepository;
}): TaxonomyResolutionPort {
  const { sql, candidates, reference } = dependencies;

  return {
    resolvePhrases: async (input) => {
      const resolved: {
        vocabularyCode: string;
        nodeId: string;
        ancestorNodeIds: string[];
        unambiguous: boolean;
      }[] = [];

      // Bounded by what one turn can say, not by the vocabulary.
      for (const phrase of input.phrases.slice(0, 8)) {
        const result = await candidates.findCandidates({
          text: phrase,
          limit: 3,
        });
        const best = result.candidates[0];
        if (best === undefined) continue;
        const second = result.candidates[1];
        const ancestors = await reference.listAncestors(
          sql,
          TaxonomyNodeIdSchema.parse(best.nodeId),
        );
        resolved.push({
          vocabularyCode: String(best.vocabularyCode),
          nodeId: String(best.nodeId),
          ancestorNodeIds: ancestors.map((node) => node.id).slice(0, 16),
          // A clear winner, or a question for the applicant.
          unambiguous:
            second === undefined ||
            best.matchTypes.some((type) => type !== "LEXICAL"),
        });
      }

      return resolved;
    },
  };
}
