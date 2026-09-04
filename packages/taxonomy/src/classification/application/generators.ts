import type { TaxonomyNode } from "../../contracts/index.js";
import type { TaxonomyReferenceRepository } from "../../application/ports.js";
import type { TaxonomyCandidate } from "../contracts/index.js";
import type { TaxonomyClassificationPolicy } from "../domain/policy.js";
import { lexicalScore } from "../domain/scoring.js";
import { tokenizeForLexicalSearch } from "../domain/tokenize.js";
import type {
  TaxonomyCandidateGenerationRequest,
  TaxonomyCandidateGenerator,
  TaxonomyLexicalSearchRepository,
} from "./ports.js";

/**
 * The four deterministic generators of taxonomy-lexical-v1. Each answers
 * "which ACTIVE nodes in scope does this text name?" through one signal
 * and nothing else: no interpretation, no model, no cross-generator talk.
 */

const inScope = (
  node: TaxonomyNode,
  request: TaxonomyCandidateGenerationRequest,
): boolean =>
  node.status === "ACTIVE" &&
  request.vocabularyCodes.includes(node.vocabularyCode);

/** `payment_infrastructure` against each scoped vocabulary. */
export function createCanonicalCodeExactGenerator(
  reference: TaxonomyReferenceRepository,
  policy: TaxonomyClassificationPolicy,
): TaxonomyCandidateGenerator {
  return {
    id: "canonical_code_exact",
    version: policy.version,
    generate: async (executor, request) => {
      // A canonical code has no spaces; a phrase cannot be one.
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(request.normalizedText)) {
        return [];
      }
      const hits: TaxonomyCandidate[] = [];
      for (const vocabularyCode of request.vocabularyCodes) {
        const node = await reference.findNodeByCanonicalCode(
          executor,
          vocabularyCode,
          request.normalizedText,
        );
        if (node !== null && inScope(node, request)) {
          hits.push({
            node,
            matchType: "CANONICAL_CODE_EXACT",
            score: 1,
            matchedText: node.canonicalCode,
          });
        }
      }
      return hits;
    },
  };
}

/** The whole normalised text equals a curated alias; several nodes may share it. */
export function createExactAliasGenerator(
  reference: TaxonomyReferenceRepository,
  policy: TaxonomyClassificationPolicy,
): TaxonomyCandidateGenerator {
  return {
    id: "alias_exact",
    version: policy.version,
    generate: async (executor, request) => {
      const nodes = await reference.findNodesByNormalizedAlias(
        executor,
        request.normalizedText,
      );
      return nodes
        .filter((node) => inScope(node, request))
        .map((node) => ({
          node,
          matchType: "ALIAS_EXACT" as const,
          score: 1,
          matchedText: request.normalizedText,
        }));
    },
  };
}

/** The whole normalised text equals a node's normalised display name. */
export function createExactDisplayNameGenerator(
  lexical: TaxonomyLexicalSearchRepository,
  policy: TaxonomyClassificationPolicy,
): TaxonomyCandidateGenerator {
  return {
    id: "display_name_exact",
    version: policy.version,
    generate: async (executor, request) => {
      const nodes = await lexical.findByNormalizedDisplayName(
        executor,
        request.normalizedText,
        request.vocabularyCodes,
      );
      return nodes
        .filter((node) => inScope(node, request))
        .map((node) => ({
          node,
          matchType: "DISPLAY_NAME_EXACT" as const,
          score: 1,
          matchedText: node.displayName,
        }));
    },
  };
}

/**
 * Bounded lexical search: SQL retrieves nodes whose label, code words or
 * alias overlap the query tokens or reach the pg_trgm word-similarity
 * floor; the versioned TypeScript formula scores them. Lexical is lexical:
 * this is never labelled semantic.
 */
export function createLexicalSearchGenerator(
  lexical: TaxonomyLexicalSearchRepository,
  policy: TaxonomyClassificationPolicy,
): TaxonomyCandidateGenerator {
  return {
    id: "lexical_search",
    version: policy.version,
    generate: async (executor, request) => {
      if (request.tokens.length === 0) {
        return [];
      }
      const hits = await lexical.search(executor, {
        normalizedText: request.normalizedText,
        tokens: request.tokens,
        vocabularyCodes: request.vocabularyCodes,
        similarityFloor: policy.lexical.retrievalSimilarityFloor,
        similarityMinCandidateLength:
          policy.lexical.similarityMinCandidateLength,
        rowLimit: policy.lexical.retrievalRowLimit,
      });
      const best = new Map<string, TaxonomyCandidate>();
      for (const hit of hits) {
        if (!inScope(hit.node, request)) {
          continue;
        }
        const scored = lexicalScore(
          {
            queryTokens: request.tokens,
            candidateTokens: tokenizeForLexicalSearch(hit.text, policy),
            candidateText: hit.text,
            wordSimilarity: hit.wordSimilarity,
            field: hit.field,
          },
          policy,
        );
        if (scored.score <= 0) {
          continue;
        }
        const current = best.get(hit.node.id);
        if (current === undefined || scored.score > current.score) {
          best.set(hit.node.id, {
            node: hit.node,
            matchType: "LEXICAL",
            score: scored.score,
            matchedText: hit.text,
            detail: `${scored.matchedTokens}/${scored.candidateTokens} tokens, similarity ${hit.wordSimilarity.toFixed(2)}`,
          });
        }
      }
      return [...best.values()];
    },
  };
}
