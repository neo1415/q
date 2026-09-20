import { z } from "zod";

import { UuidSchema } from "@capital-q/contracts";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * RECOMMENDATION_EXPLANATION — `recommendation.explanation` v1 (doc 19
 * §57–§59; CQ-REC-007R B).
 *
 * "Why am I seeing this company?" is a question about something Capital Q
 * already did, and the answer already exists: REC-005 scored a feature
 * snapshot under a versioned ranking config, and REC-007 B replays exactly
 * that snapshot to say which criteria matched, which did not, and which
 * could not be established. This tool hands the model those factors.
 *
 * It exists so that the answer is the same answer the Discover surface
 * gives. The alternative — letting the model read a mandate and a company
 * and reason about fit — would produce a second, fluent, unversioned
 * opinion that nobody could reproduce and that would quietly disagree with
 * the product. Doc 19 §59 divides it plainly: the ranking engine filters,
 * generates, scores and orders; Q interprets and explains. This is the
 * seam between those two sentences.
 *
 * What it deliberately does not return: any score, weight or similarity,
 * and the item's position in the slate. A rank is not a reason, and a
 * number in an explanation becomes arithmetic the moment a model phrases
 * it (§56). Factors and their outcomes are the whole vocabulary.
 *
 * The caller names a company and never a slate. The slate is resolved from
 * the actor's own investor organisation, server side, because a slate id
 * arriving from a model would be a claim of authority rather than a fact.
 */

export const RECOMMENDATION_EXPLANATION = "recommendation.explanation" as const;

export const RecommendationExplanationInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The company to explain. Use an id from discovery.slate; never invent one.",
    ),
  })
  .strict();
export type RecommendationExplanationInput = z.infer<
  typeof RecommendationExplanationInputSchema
>;

const FactorSchema = z
  .object({
    dimension: z.string(),
    outcome: z.string(),
    /** Reader-facing wording for the factor; already bounded by REC-007 B. */
    label: z.string(),
  })
  .strict();

export const RecommendationExplanationOutputSchema = z
  .object({
    status: z.enum([
      "EXPLAINED",
      /** The company is in no current slate of this person's. */
      "NOT_RECOMMENDED",
      /** No recommendation explanations are composed in this deployment. */
      "NOT_AVAILABLE",
    ]),
    /** The deterministic explanation, in Capital Q's own words. */
    summary: z.string().nullable(),
    matched: z.array(FactorSchema).max(12),
    notMatched: z.array(FactorSchema).max(12),
    unknown: z.array(FactorSchema).max(12),
    /** Which ranking configuration produced it, so an answer is reproducible. */
    rankingVersion: z.string().nullable(),
  })
  .strict();
export type RecommendationExplanationOutput = z.infer<
  typeof RecommendationExplanationOutputSchema
>;

const UNAVAILABLE: RecommendationExplanationOutput = {
  status: "NOT_AVAILABLE",
  summary: null,
  matched: [],
  notMatched: [],
  unknown: [],
  rankingVersion: null,
};

const NOT_RECOMMENDED: RecommendationExplanationOutput = {
  ...UNAVAILABLE,
  status: "NOT_RECOMMENDED",
};

export function createRecommendationExplanationTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<
    RecommendationExplanationInput,
    RecommendationExplanationOutput,
    null
  >({
    id: RECOMMENDATION_EXPLANATION,
    version: 1,
    status: "ACTIVE",
    providerName: "recommendation_explanation",
    description:
      "Explains why Capital Q recommended a particular company to this person: which of their stated criteria it matched, which it did not, and which could not be established. Call it whenever they ask why a company is in their recommendations, why they are seeing it, what fits, or what does not. It returns the platform's own explanation; do not work out a fit yourself, and do not describe anything it does not return.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: RecommendationExplanationInputSchema,
    output: RecommendationExplanationOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const explanations = ports.recommendationExplanations;
      if (explanations === undefined) return UNAVAILABLE;

      const result = await explanations.explainCurrent({
        actor: context.actor,
        companyId: input.companyId,
        correlationId: context.correlationId,
      });
      // Every refusal reads the same from here. Which slate was stale and
      // which snapshot had gone is an operational detail, and telling a
      // model the difference would invite it to explain the difference.
      if (result.kind !== "EXPLAINED") return NOT_RECOMMENDED;

      const factor = (f: {
        dimension: string;
        outcome: string;
        label: string;
      }) => ({ dimension: f.dimension, outcome: f.outcome, label: f.label });
      const explanation = result.explanation;
      return {
        status: "EXPLAINED" as const,
        summary: explanation.summary,
        matched: explanation.matchedFactors.map(factor),
        notMatched: explanation.mismatchedFactors.map(factor),
        unknown: explanation.uncertainties.map(factor),
        rankingVersion: explanation.generatedFromRankingVersion,
      };
    },
  });
}
