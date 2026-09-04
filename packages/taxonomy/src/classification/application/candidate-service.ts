import { z } from "zod";

import {
  TAXONOMY_CANDIDATE_DEFAULT_LIMIT,
  TAXONOMY_CANDIDATE_MAX_LIMIT,
  TAXONOMY_CANDIDATE_MAX_VOCABULARIES,
  TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH,
  TaxonomyClassificationStrategySchema,
  TaxonomyVocabularyCodeSchema,
  type TaxonomyClassificationStrategy,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";

import type {
  TaxonomyVersionSet,
  TaxonomyVocabularyCode,
} from "../../contracts/index.js";
import type { TaxonomyReferenceRepository } from "../../application/ports.js";
import { TaxonomyVocabularyNotFoundError } from "../../domain/errors.js";
import {
  TAXONOMY_CLASSIFIER_IDENTITY,
  TAXONOMY_SUPPORTED_STRATEGIES,
  type TaxonomyCandidate,
  type TaxonomyClassificationResult,
  type TaxonomySupportedStrategy,
} from "../contracts/index.js";
import { TaxonomyClassifierNotAvailableError } from "../domain/errors.js";
import {
  TAXONOMY_CLASSIFICATION_POLICY_V1,
  type TaxonomyClassificationPolicy,
} from "../domain/policy.js";
import { resolveCandidates } from "../domain/resolve.js";
import {
  hashClassificationInput,
  normalizeClassificationInput,
  tokenizeForLexicalSearch,
} from "../domain/tokenize.js";
import {
  createCanonicalCodeExactGenerator,
  createExactAliasGenerator,
  createExactDisplayNameGenerator,
  createLexicalSearchGenerator,
} from "./generators.js";
import { observeClassification } from "./metrics.js";
import type {
  TaxonomyCandidateGenerator,
  TaxonomyLexicalSearchRepository,
} from "./ports.js";

/**
 * The deterministic classifier and the stateless candidate lookup.
 *
 *   request -> normalise -> scope vocabularies -> generators
 *   (canonical code -> alias -> display name -> lexical) -> merge ->
 *   rank -> ambiguity / abstention -> typed result
 *
 * Nothing here persists, audits or publishes: autocomplete and onboarding
 * suggestions are free of side effects. Persistent provenance is the
 * separate classification-run use case. No model, no embeddings.
 */

export const FindTaxonomyCandidatesInputSchema = z
  .object({
    text: z
      .string()
      .max(TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH)
      .refine((value) => value.trim().length > 0, {
        message: "text must not be empty",
      }),
    vocabularyCodes: z
      .array(TaxonomyVocabularyCodeSchema)
      .min(1)
      .max(TAXONOMY_CANDIDATE_MAX_VOCABULARIES)
      .optional(),
    strategy: TaxonomyClassificationStrategySchema.optional(),
    limit: z.number().int().min(1).max(TAXONOMY_CANDIDATE_MAX_LIMIT).optional(),
  })
  .strict();

export type FindTaxonomyCandidatesInput = {
  readonly text: string;
  readonly vocabularyCodes?: readonly TaxonomyVocabularyCode[] | undefined;
  readonly strategy?: TaxonomyClassificationStrategy | undefined;
  readonly limit?: number | undefined;
};

export type TaxonomyCandidateFinder = {
  readonly findCandidates: (
    input: FindTaxonomyCandidatesInput,
  ) => Promise<TaxonomyClassificationResult>;
};

export type ClassificationScope = {
  /** ACTIVE vocabularies in scope; may be empty (NO_ACTIVE_VOCABULARY). */
  readonly vocabularyCodes: readonly TaxonomyVocabularyCode[];
  readonly versions: TaxonomyVersionSet;
};

export type ClassifyInScopeInput = {
  readonly text: string;
  readonly strategy: TaxonomySupportedStrategy;
  readonly limit: number;
};

/** The classifier core shared by the stateless finder and persistent runs. */
export type TaxonomyClassifier = {
  readonly policy: TaxonomyClassificationPolicy;
  readonly requireSupportedStrategy: (
    strategy: TaxonomyClassificationStrategy | undefined,
  ) => TaxonomySupportedStrategy;
  readonly resolveScope: (
    executor: DatabaseExecutor,
    vocabularyCodes: readonly TaxonomyVocabularyCode[] | undefined,
  ) => Promise<ClassificationScope>;
  readonly classifyInScope: (
    executor: DatabaseExecutor,
    scope: ClassificationScope,
    input: ClassifyInScopeInput,
  ) => Promise<TaxonomyClassificationResult>;
};

export type TaxonomyClassifierDependencies = {
  readonly reference: TaxonomyReferenceRepository;
  readonly lexical: TaxonomyLexicalSearchRepository;
  readonly policy?: TaxonomyClassificationPolicy | undefined;
  /** Test seam / future adapters. Defaults to the four deterministic generators. */
  readonly generators?:
    | {
        readonly exact: readonly TaxonomyCandidateGenerator[];
        readonly lexical: readonly TaxonomyCandidateGenerator[];
      }
    | undefined;
};

function isSupported(
  strategy: TaxonomyClassificationStrategy,
): strategy is TaxonomySupportedStrategy {
  return (TAXONOMY_SUPPORTED_STRATEGIES as readonly string[]).includes(
    strategy,
  );
}

export function createTaxonomyClassifier(
  dependencies: TaxonomyClassifierDependencies,
): TaxonomyClassifier {
  const policy = dependencies.policy ?? TAXONOMY_CLASSIFICATION_POLICY_V1;
  const { reference, lexical } = dependencies;
  const generators = dependencies.generators ?? {
    exact: [
      createCanonicalCodeExactGenerator(reference, policy),
      createExactAliasGenerator(reference, policy),
      createExactDisplayNameGenerator(lexical, policy),
    ],
    lexical: [createLexicalSearchGenerator(lexical, policy)],
  };

  const run = async (
    set: readonly TaxonomyCandidateGenerator[],
    executor: DatabaseExecutor,
    request: Parameters<TaxonomyCandidateGenerator["generate"]>[1],
  ): Promise<readonly TaxonomyCandidate[]> => {
    const hits: TaxonomyCandidate[] = [];
    for (const generator of set) {
      hits.push(...(await generator.generate(executor, request)));
    }
    return hits;
  };

  return {
    policy,
    requireSupportedStrategy: (strategy) => {
      const chosen = strategy ?? "AUTO";
      if (!isSupported(chosen)) {
        throw new TaxonomyClassifierNotAvailableError(chosen);
      }
      return chosen;
    },
    resolveScope: async (executor, vocabularyCodes) => {
      const active = await reference.listVocabularies(executor);
      const activeCodes = new Set(active.map((v) => v.code));
      let codes: TaxonomyVocabularyCode[];
      if (vocabularyCodes === undefined) {
        codes = active.map((v) => v.code);
      } else {
        codes = [];
        for (const code of vocabularyCodes) {
          if (activeCodes.has(code)) {
            codes.push(code);
            continue;
          }
          // Retired vocabularies are silently out of scope; unknown ones are an error.
          const known = await reference.findVocabularyByCode(executor, code);
          if (known === null) {
            throw new TaxonomyVocabularyNotFoundError();
          }
        }
      }
      const all = await reference.getVersionSet(executor);
      const versions: Record<string, number> = {};
      for (const code of codes) {
        const version = all[code];
        if (version !== undefined) {
          versions[code] = version;
        }
      }
      return { vocabularyCodes: codes, versions };
    },
    classifyInScope: async (executor, scope, input) => {
      if (scope.vocabularyCodes.length === 0) {
        return {
          resolution: "ABSTAINED",
          candidates: [],
          abstentionReason: "NO_ACTIVE_VOCABULARY",
          taxonomyVersions: scope.versions,
          classifier: TAXONOMY_CLASSIFIER_IDENTITY,
        };
      }
      const normalizedText = normalizeClassificationInput(input.text);
      const request = {
        rawText: input.text,
        normalizedText,
        tokens: tokenizeForLexicalSearch(normalizedText, policy),
        vocabularyCodes: scope.vocabularyCodes,
        limit: input.limit,
      };
      let raw: readonly TaxonomyCandidate[];
      switch (input.strategy) {
        case "EXACT":
          raw = await run(generators.exact, executor, request);
          break;
        case "LEXICAL":
          raw = [
            ...(await run(generators.exact, executor, request)),
            ...(await run(generators.lexical, executor, request)),
          ];
          break;
        case "AUTO": {
          // Cheap, high-certainty first; lexical only when nothing exact fits.
          const exact = await run(generators.exact, executor, request);
          raw =
            exact.length > 0
              ? exact
              : await run(generators.lexical, executor, request);
          break;
        }
      }
      const resolved = resolveCandidates(raw, policy, input.limit);
      return {
        resolution: resolved.resolution,
        candidates: resolved.candidates,
        ...(resolved.abstentionReason === undefined
          ? {}
          : { abstentionReason: resolved.abstentionReason }),
        taxonomyVersions: scope.versions,
        classifier: TAXONOMY_CLASSIFIER_IDENTITY,
      };
    },
  };
}

export type TaxonomyCandidateFinderDependencies = {
  readonly sql: DatabaseExecutor;
  readonly classifier: TaxonomyClassifier;
  readonly logger?: Logger | undefined;
};

/** Stateless lookup for autocomplete, onboarding suggestions and manual search. */
export function createTaxonomyCandidateFinder(
  dependencies: TaxonomyCandidateFinderDependencies,
): TaxonomyCandidateFinder {
  const { sql, classifier, logger } = dependencies;
  return {
    findCandidates: async (raw) => {
      const input = FindTaxonomyCandidatesInputSchema.parse(raw);
      const strategy = classifier.requireSupportedStrategy(input.strategy);
      const started = performance.now();
      const scope = await classifier.resolveScope(sql, input.vocabularyCodes);
      const result = await classifier.classifyInScope(sql, scope, {
        text: input.text,
        strategy,
        limit: input.limit ?? TAXONOMY_CANDIDATE_DEFAULT_LIMIT,
      });
      observeClassification(
        {
          strategy,
          inputLength: input.text.length,
          inputHash: hashClassificationInput(input.text),
          vocabularyCount: scope.vocabularyCodes.length,
          durationMs: Math.round(performance.now() - started),
          result,
        },
        logger,
      );
      return result;
    },
  };
}
