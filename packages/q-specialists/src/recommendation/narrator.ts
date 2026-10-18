import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  FitExplanationResultSchema,
  renderPrompt,
  type FitExplanationResult,
  type FitExplanationVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";

/**
 * Q phrasing a recommendation explanation (CQ-REC-007 C; doc 19 §58–§59).
 *
 *   ranking engine  filters, generates, scores, orders
 *   REC-007 B       which criteria matched, which did not, what is unknown
 *   this file       the same facts, in Q's voice
 *
 * The model is given bounded factor labels and two short descriptions, and
 * nothing else: no feature snapshot, no mandate, no score, no similarity,
 * no private company material. It cannot change a fact even if it tries,
 * because the caller keeps the deterministic factor arrays and takes only
 * the prose — and takes that only if it passes the grounding checks below.
 *
 * Every failure is in-band. A rate limit, an outage, a refusal or an
 * ungrounded answer all return UNAVAILABLE, and the caller shows the
 * deterministic explanation it already had. Doc 19 §58: if Q is
 * unavailable, the explanation still works.
 */

/** One factor as the reader-facing explanation carries it (REC-007 B). */
export type NarratableFactor = {
  readonly dimension: string;
  readonly outcome:
    "MATCH" | "PARTIAL" | "MISMATCH" | "UNKNOWN" | "NOT_APPLICABLE";
  readonly label: string;
};

export type RecommendationNarrationRequest = {
  readonly tenantId: string;
  readonly userId: string;
  readonly correlationId: string;
  /** The company's own declared one-liner. Untrusted content, fenced by the prompt. */
  readonly companyDescription: string;
  /** How the investor's own mandate reads, in their words or a safe summary. */
  readonly investorDescription: string;
  readonly matchedFactors: readonly NarratableFactor[];
  readonly mismatchedFactors: readonly NarratableFactor[];
  readonly uncertainties: readonly NarratableFactor[];
  readonly signal?: AbortSignal | undefined;
};

export const NARRATION_UNAVAILABLE_REASONS = [
  "NO_FACTORS",
  "NO_ELIGIBLE_MODEL_ROUTE",
  "MODEL_UNAVAILABLE",
  "MODEL_OUTPUT_REJECTED",
  /** The model said something the supplied factors do not support. */
  "UNGROUNDED",
] as const;
export type NarrationUnavailableReason =
  (typeof NARRATION_UNAVAILABLE_REASONS)[number];

export type RecommendationNarration =
  | {
      readonly kind: "NARRATED";
      readonly summary: string;
      readonly providerCode: string;
      readonly modelCode: string;
      readonly latencyMs: number;
    }
  | {
      readonly kind: "UNAVAILABLE";
      readonly reason: NarrationUnavailableReason;
    };

export type RecommendationNarrator = {
  readonly narrate: (
    request: RecommendationNarrationRequest,
  ) => Promise<RecommendationNarration>;
};

export type RecommendationNarratorDependencies = {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  /**
   * The class of the material in the request. An explanation carries the
   * investor's own declared criteria and a discoverable company's declared
   * one-liner, which is network-visible rather than public.
   */
  readonly sensitivity?: ModelSensitivity | undefined;
  /** Doc 15 §62; set by a composition that attested its data is invented. */
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
};

const OUTCOME_TO_PROMPT = {
  MATCH: "MATCHED",
  PARTIAL: "PARTIAL",
  MISMATCH: "NOT_MATCHED",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "UNKNOWN",
} as const;

/**
 * Anything that would turn an explanation into a number or a prediction.
 * The digit is matched on its own rather than inside the word-boundary
 * group: `\b\d\b` lets "92%" straight through, because the 9 has no
 * boundary after it.
 */
const FORBIDDEN_PROSE =
  /\d|\b(per cent|percent|percentage|probability|likelihood|odds|scores?|scored|scoring|weights?|weighted|similarity|confidence level)\b/i;

/** What a person would call each dimension; used to catch invented ones. */
const DIMENSION_WORDS: Readonly<Record<string, readonly string[]>> = {
  STAGE: ["stage"],
  GEOGRAPHY: ["geograph", "country", "region", "based in", "located"],
  TAXONOMY: ["sector", "industry"],
  SEMANTIC: ["describ", "does", "business"],
  CHEQUE: ["cheque", "check size", "ticket"],
};

export function createRecommendationNarrator(
  dependencies: RecommendationNarratorDependencies,
): RecommendationNarrator {
  const { gateway, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();

  return {
    narrate: async (request) => {
      const all = [
        ...request.matchedFactors,
        ...request.mismatchedFactors,
        ...request.uncertainties,
      ];
      // Nothing to explain is not a model problem, and asking anyway would
      // invite the model to fill the silence.
      if (all.length === 0)
        return { kind: "UNAVAILABLE", reason: "NO_FACTORS" };

      const factors = all.map((factor) => ({
        factor: factor.dimension,
        // Every V1 fit dimension is a preference. The hard gate is not
        // among them: an item in a slate already passed it, and calling a
        // preference a constraint would misstate what the ranker did.
        kind: "SOFT_PREFERENCE" as const,
        outcome: OUTCOME_TO_PROMPT[factor.outcome],
        detail: factor.label,
      }));

      let rendered;
      try {
        rendered = renderPrompt<FitExplanationVariables>(registry, {
          task: "FIT_EXPLANATION",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You are explaining a recommendation Capital Q already made. You cannot re-rank it, change a factor, add one, or say how likely an investment is. If a factor is unknown, say it is unknown.",
          variables: {
            factors,
            // REC-005 assigns no overall label, so there is none to restate.
            // A model that invents one is caught below.
            overallFit: null,
            audience: "INVESTOR",
            companyDescription: request.companyDescription.slice(0, 400),
            investorDescription: request.investorDescription.slice(0, 400),
            relationshipState: null,
          },
        });
      } catch (error: unknown) {
        logger?.warn({ err: error }, "fit explanation prompt did not render");
        return { kind: "UNAVAILABLE", reason: "MODEL_OUTPUT_REJECTED" };
      }

      let result: FitExplanationResult | undefined;
      let providerCode: string;
      let modelCode: string;
      let latencyMs: number;
      try {
        const response = await gateway.execute<FitExplanationResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            budget: budgetForTaskClass("NORMAL_DIALOGUE"),
            sensitivity: dependencies.sensitivity ?? "NETWORK_VISIBLE",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: request.tenantId,
              userId: request.userId,
              correlationId: request.correlationId,
            },
          },
          {
            schema: FitExplanationResultSchema,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        providerCode = response.providerCode;
        modelCode = response.modelCode;
        latencyMs = response.latencyMs;
        if (response.output.kind === "STRUCTURED") {
          result = response.output.value;
        }
      } catch (error: unknown) {
        const failureClass = (error as { failureClass?: string }).failureClass;
        logger?.warn(
          { failureClass: failureClass ?? "UNKNOWN" },
          "recommendation explanation was not phrased by a model",
        );
        return {
          kind: "UNAVAILABLE",
          reason:
            failureClass === "POLICY_INELIGIBLE"
              ? "NO_ELIGIBLE_MODEL_ROUTE"
              : "MODEL_UNAVAILABLE",
        };
      }
      if (result === undefined) {
        return { kind: "UNAVAILABLE", reason: "MODEL_OUTPUT_REJECTED" };
      }

      const ungrounded = groundingFailure(result, all);
      if (ungrounded !== null) {
        // Codes and the rule that failed; never the sentence it produced.
        logger?.warn(
          { rule: ungrounded, provider: providerCode },
          "recommendation explanation was not grounded in the supplied factors",
        );
        return { kind: "UNAVAILABLE", reason: "UNGROUNDED" };
      }

      return {
        kind: "NARRATED",
        summary: result.explanation,
        providerCode,
        modelCode,
        latencyMs,
      };
    },
  };
}

/**
 * The model may phrase, organise and soften. It may not add a reason,
 * change an outcome, or turn an ordering into a quantity. Each rule below
 * is mechanical, so "grounded" is not a matter of taste.
 */
export function groundingFailure(
  result: FitExplanationResult,
  supplied: readonly NarratableFactor[],
): string | null {
  // A label nobody supplied is an invented verdict (doc 19 §56).
  if (result.overallFitRestated !== null) return "OVERALL_FIT_INVENTED";

  const prose = result.explanation;
  if (FORBIDDEN_PROSE.test(prose)) return "QUANTITY_CLAIMED";

  const suppliedDimensions = new Set(supplied.map((f) => f.dimension));
  for (const [dimension, words] of Object.entries(DIMENSION_WORDS)) {
    if (suppliedDimensions.has(dimension)) continue;
    // A dimension the ranker never scored must not appear as a reason.
    if (words.some((word) => prose.toLowerCase().includes(word))) {
      return `DIMENSION_NOT_SUPPLIED:${dimension}`;
    }
  }

  // A dimension the ranker could not establish must not be asserted as a
  // match: unknown never becomes a positive (doc 19 §92).
  const unknownDimensions = supplied
    .filter((f) => f.outcome === "UNKNOWN" || f.outcome === "NOT_APPLICABLE")
    .map((f) => f.dimension);
  for (const claim of result.matched) {
    const text = String(claim).toLowerCase();
    for (const dimension of unknownDimensions) {
      if ((DIMENSION_WORDS[dimension] ?? []).some((w) => text.includes(w))) {
        return `UNKNOWN_CLAIMED_AS_MATCH:${dimension}`;
      }
    }
  }
  return null;
}
