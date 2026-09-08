import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InvestorMandateSynthesisV2ResultSchema,
  renderPrompt,
  type InvestorMandateSynthesisV2Result,
  type InvestorMandateVariables,
  type MandateDimension,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  MandateAmbiguity,
  MandateInference,
  MandateSynthesis,
  MandateSynthesisTelemetry,
  ProposedConstraint,
  ProposedTaxonomyPhrase,
  RefusedCriterion,
} from "./contracts.js";
import {
  constraintDimensionFor,
  isColumnDimension,
  preferenceClassFor,
  PROTECTED_SCREENING_MESSAGE,
  proposesExclusion,
  requestsProtectedScreening,
  requiresTaxonomyMapping,
} from "./semantics.js";

/**
 * Reading an investor's own description of what they invest in
 * (CQ-Q-022 §27-§30, §65, §90).
 *
 * One model call, through the Model Gateway, over the investor's narrative
 * and the choices they already made. Everything it returns is a proposal,
 * and the validation below is what keeps it one:
 *
 *   - No reading becomes a hard exclusion. `preferenceClassFor` has no
 *     branch that returns HARD_EXCLUSION, so the strongest thing a model's
 *     output can produce is AVOID — which still ranks a candidate down and
 *     makes nothing ineligible (§20).
 *   - No sector phrase becomes a taxonomy id here. Capital Q's own service
 *     maps them, because companies are classified with those same ids and a
 *     model-invented id would be a criterion nobody chose (§41).
 *   - Nothing broadens the mandate. A dimension the investor already
 *     answered is not re-proposed, so a synthesis cannot quietly widen a
 *     stage range they narrowed by hand.
 *   - Protected-trait screening is refused in the open. The canonical
 *     dimension allowlist already makes it unrepresentable; this reports it
 *     so a person is told rather than left wondering (§36).
 *
 * There is no provider SDK here. A failure — including "no configured
 * provider may receive material this sensitive" — becomes a coded blocked
 * state and onboarding carries on by selection, which is how it worked
 * before Q existed.
 */

export type MandateSynthesisGateway = {
  readonly execute: <T>(
    request: {
      readonly taskClass: "STRUCTURED_EXTRACTION";
      readonly sensitivity: string;
      readonly budget: unknown;
      readonly messages: unknown;
      readonly output: unknown;
      readonly attribution: {
        readonly tenantId: string;
        readonly userId: string;
      };
    },
    options: {
      readonly schema: unknown;
      readonly signal?: AbortSignal | undefined;
    },
  ) => Promise<{
    readonly providerCode: string;
    readonly modelCode: string;
    readonly cost: { readonly amount: number };
    readonly output:
      | { readonly kind: "STRUCTURED"; readonly value: T }
      | { readonly kind: string };
  }>;
};

/** Canonical taxonomy resolution. Capital Q's own service, never the model's. */
export type MandateTaxonomyPort = {
  readonly resolve: (
    phrase: string,
  ) => Promise<readonly { readonly nodeId: string }[]>;
};

export type MandateSynthesisDependencies = {
  readonly gateway: MandateSynthesisGateway;
  readonly taxonomy?: MandateTaxonomyPort | undefined;
  readonly registry?: PromptRegistry | undefined;
  /**
   * A mandate is commercially sensitive: cheque ceilings, exclusions and
   * portfolio concerns are exactly what an investor would not want read.
   * The gateway decides provider eligibility from this BEFORE contacting
   * one, and a refusal is honoured rather than worked around (§37, §73).
   */
  readonly sensitivity?: string | undefined;
  readonly budget?: unknown;
  readonly logger?: Logger | undefined;
};

export type MandateSynthesisRequest = {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  /** What the investor wrote about what they invest in. */
  readonly narrative: string;
  /** Dimensions they already answered by selection, so nothing is re-proposed. */
  readonly alreadyDeclared: readonly {
    readonly dimension: MandateDimension;
    readonly value: string;
  }[];
  /**
   * Authorised observations of past behaviour, as data. They can only reach
   * `inferences` and `tensions`; a declaration is never rewritten by one
   * (§21, §56).
   */
  readonly observedBehaviour: readonly string[];
  /** The session revision this runs against, so a stale result is refusable (§49). */
  readonly revision: number;
  readonly signal?: AbortSignal | undefined;
};

function emptyTelemetry(): MandateSynthesisTelemetry {
  return {
    promptBundleVersion: null,
    providerCode: null,
    modelCode: null,
    constraintCount: 0,
    taxonomyPhraseCount: 0,
    mappedTaxonomyCount: 0,
    proposedExclusionCount: 0,
    ambiguityCount: 0,
    inferenceCount: 0,
    refusedCount: 0,
    latencyMs: 0,
    costUsd: 0,
  };
}

function blocked(
  reason: NonNullable<MandateSynthesis["blocked"]>,
  revision: number,
  telemetry: MandateSynthesisTelemetry,
  refused: readonly RefusedCriterion[] = [],
): MandateSynthesis {
  return {
    constraints: [],
    taxonomy: [],
    columns: [],
    ambiguities: [],
    inferences: [],
    tensions: [],
    refused,
    missing: [],
    summary: "",
    blocked: reason,
    computedFromRevision: revision,
    telemetry,
  };
}

export function createMandateSynthesis(
  dependencies: MandateSynthesisDependencies,
): {
  readonly synthesise: (
    request: MandateSynthesisRequest,
  ) => Promise<MandateSynthesis>;
} {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, taxonomy, logger } = dependencies;

  return {
    synthesise: async (
      request: MandateSynthesisRequest,
    ): Promise<MandateSynthesis> => {
      const started = Date.now();
      const narrative = request.narrative.trim();

      if (narrative.length === 0) {
        // Nothing written is not a failure: every dimension is answerable by
        // selection, and the journey is selection-first by design (§27).
        return blocked("NO_NARRATIVE", request.revision, emptyTelemetry());
      }

      // Checked before the model is asked. If the whole request is about a
      // protected characteristic there is nothing legitimate to synthesise,
      // and sending it to a provider would achieve nothing but sending it.
      if (requestsProtectedScreening(narrative)) {
        logger?.warn(
          { refused: 1 },
          "investor mandate narrative requested screening Capital Q does not do",
        );
        return blocked(
          "PROTECTED_CRITERIA_ONLY",
          request.revision,
          emptyTelemetry(),
          [{ quote: "", message: PROTECTED_SCREENING_MESSAGE }],
        );
      }

      const variables: Omit<
        InvestorMandateVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        investorNarrative: narrative,
        observedBehaviour: [...request.observedBehaviour],
        alreadyDeclared: request.alreadyDeclared.map((item) => ({
          dimension: item.dimension,
          value: item.value.slice(0, 1_000),
        })),
      };

      const rendered = renderPrompt<InvestorMandateVariables>(registry, {
        task: "INVESTOR_MANDATE_SYNTHESIS",
        operatingMode: "INVESTOR",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot write anything, change any permission, or confirm anything. Everything you produce is reviewed by the investor before it becomes their mandate.",
        variables,
      });

      let telemetry: MandateSynthesisTelemetry = {
        ...emptyTelemetry(),
        promptBundleVersion: rendered.bundle.bundleVersion,
      };
      let result: InvestorMandateSynthesisV2Result | undefined;

      try {
        const response =
          await gateway.execute<InvestorMandateSynthesisV2Result>(
            {
              taskClass: "STRUCTURED_EXTRACTION",
              sensitivity: dependencies.sensitivity ?? "CONFIDENTIAL",
              budget: dependencies.budget,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: {
                tenantId: request.tenantId,
                userId: request.userId,
              },
            },
            {
              schema: InvestorMandateSynthesisV2ResultSchema,
              ...(request.signal === undefined
                ? {}
                : { signal: request.signal }),
            },
          );
        telemetry = {
          ...telemetry,
          providerCode: response.providerCode,
          modelCode: response.modelCode,
          costUsd: response.cost.amount,
        };
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as {
              readonly value: InvestorMandateSynthesisV2Result;
            }
          ).value;
        }
      } catch (error: unknown) {
        const failureClass = (error as { failureClass?: string }).failureClass;
        logger?.warn(
          { failureClass: failureClass ?? "UNKNOWN" },
          "investor mandate synthesis produced nothing",
        );
        return blocked(
          failureClass === "POLICY_INELIGIBLE"
            ? "NO_ELIGIBLE_MODEL_ROUTE"
            : "MODEL_UNAVAILABLE",
          request.revision,
          { ...telemetry, latencyMs: Date.now() - started },
        );
      }

      if (result === undefined) {
        return blocked("MODEL_OUTPUT_REJECTED", request.revision, {
          ...telemetry,
          latencyMs: Date.now() - started,
        });
      }

      // A dimension the investor answered by selection is theirs. Not
      // re-proposed, and certainly not widened (§50).
      const declaredAlready = new Set(
        request.alreadyDeclared.map((item) => item.dimension),
      );

      const constraints: ProposedConstraint[] = [];
      const columns: {
        dimension: MandateDimension;
        value: string;
        quote: string | null;
      }[] = [];
      const refused: RefusedCriterion[] = result.refusedCriteria.map(
        (item) => ({
          quote: item.quote,
          message: PROTECTED_SCREENING_MESSAGE,
        }),
      );

      for (const candidate of result.declared) {
        if (declaredAlready.has(candidate.dimension)) {
          continue;
        }
        // Second line of defence. The dimension allowlist below already
        // makes a protected criterion unrepresentable; this stops one being
        // filed as custom text where a person would later read it as policy.
        if (requestsProtectedScreening(candidate.value)) {
          refused.push({
            quote: candidate.value,
            message: PROTECTED_SCREENING_MESSAGE,
          });
          continue;
        }
        if (isColumnDimension(candidate.dimension)) {
          columns.push({
            dimension: candidate.dimension,
            value: candidate.value,
            quote: candidate.quote,
          });
          continue;
        }
        if (requiresTaxonomyMapping(candidate.dimension)) {
          // Sector language travels as a phrase, resolved below. A raw
          // string here would never match a company's node ids.
          continue;
        }
        constraints.push({
          dimension: candidate.dimension,
          constraintDimension: constraintDimensionFor(candidate.dimension),
          value: candidate.value,
          quote: candidate.quote,
          preferenceClass: preferenceClassFor(candidate.strength),
          proposesExclusion: proposesExclusion(candidate.strength),
          confidence: candidate.confidence,
        });
      }

      const taxonomyPhrases: ProposedTaxonomyPhrase[] = [];
      for (const phrase of result.taxonomyPhrases) {
        const resolved =
          taxonomy === undefined ? [] : await taxonomy.resolve(phrase.phrase);
        taxonomyPhrases.push({
          phrase: phrase.phrase,
          preferenceClass: preferenceClassFor(phrase.strength),
          proposesExclusion: proposesExclusion(phrase.strength),
          nodeIds: resolved.map((node) => node.nodeId),
        });
      }

      const ambiguities: MandateAmbiguity[] = result.ambiguities.map(
        (item) => ({
          dimension: item.dimension,
          kind: item.kind,
          quote: item.quote,
          question: item.question,
        }),
      );

      const inferences: MandateInference[] = result.inferred.map((item) => ({
        dimension: item.dimension,
        value: item.value,
        basis: item.basis,
        confidence: item.confidence,
      }));

      const proposedExclusions =
        constraints.filter((item) => item.proposesExclusion).length +
        taxonomyPhrases.filter((item) => item.proposesExclusion).length;

      telemetry = {
        ...telemetry,
        constraintCount: constraints.length,
        taxonomyPhraseCount: taxonomyPhrases.length,
        mappedTaxonomyCount: taxonomyPhrases.filter(
          (item) => item.nodeIds.length > 0,
        ).length,
        proposedExclusionCount: proposedExclusions,
        ambiguityCount: ambiguities.length,
        inferenceCount: inferences.length,
        refusedCount: refused.length,
        latencyMs: Date.now() - started,
      };

      // Counts, codes and versions. No cheque figure, no exclusion, no
      // phrase and no narrative (§74).
      logger?.info(
        {
          promptBundleVersion: telemetry.promptBundleVersion,
          provider: telemetry.providerCode,
          constraints: constraints.length,
          taxonomyPhrases: taxonomyPhrases.length,
          mappedTaxonomy: telemetry.mappedTaxonomyCount,
          proposedExclusions,
          ambiguities: ambiguities.length,
          inferences: inferences.length,
          refused: refused.length,
          revision: request.revision,
        },
        "investor mandate synthesis completed",
      );

      return {
        constraints,
        taxonomy: taxonomyPhrases,
        columns,
        ambiguities,
        inferences,
        tensions: result.tensions,
        refused,
        missing: result.missing,
        summary: result.summary,
        blocked: null,
        computedFromRevision: request.revision,
        telemetry,
      };
    },
  };
}

/**
 * Whether a synthesis still describes the session it was computed from
 * (§48, §49, §91).
 *
 * An investor who edits their stages while a synthesis is in flight must
 * not have the older reading land on top of the newer choice. The check is
 * a comparison rather than a lock because the cost of recomputing is one
 * model call and the cost of being wrong is a mandate that misdescribes
 * them.
 */
export function synthesisIsCurrent(
  synthesis: Pick<MandateSynthesis, "computedFromRevision">,
  sessionRevision: number,
): boolean {
  return synthesis.computedFromRevision === sessionRevision;
}
