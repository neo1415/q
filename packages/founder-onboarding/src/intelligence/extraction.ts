import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  FounderExtractionV2ResultSchema,
  renderPrompt,
  type FounderExtractionV2Result,
  type FounderExtractionV2Variables,
  type FounderFactKey,
  type FounderSourcePassage,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  FounderAmbiguity,
  FounderCandidate,
  FounderConflict,
  FounderExtractionOutcome,
  FounderExtractionTelemetry,
  FounderSourceOrigin,
  FounderTaxonomySuggestion,
} from "./contracts.js";
import { describeBusinessShape, type BusinessShape } from "./mapping.js";

/**
 * Reading a founder's own material (CQ-Q-021 §38-§40).
 *
 * One model call, through the Model Gateway, over passages the Context
 * Firewall already authorised. What comes back is validated before any of
 * it is offered to a person:
 *
 *   - Citations resolve to a passage the render actually showed, or they
 *     are dropped. The model writes opaque `S<n>` labels and never an
 *     identifier, so a candidate cannot claim to come from a document that
 *     was never supplied — that is not forbidden, it is unexpressible.
 *   - Nothing is VERIFIED. The schema excludes it and the mapping below
 *     refuses it again, because a deck asserting something is a claim
 *     whatever confidence a model attaches to it (§51).
 *   - A candidate that cites nothing and quotes nothing while asserting a
 *     specific figure is dropped. That shape is what general model
 *     knowledge produces, and it is never evidence about this company.
 *
 * There is no provider SDK here and no HTTP client. A failure — including
 * "no configured provider may receive material this sensitive" — becomes a
 * coded blocked state, and onboarding carries on without it (§46).
 */

export type FounderExtractionSource = {
  /** The Evidence document this passage belongs to. */
  readonly documentId: string;
  readonly documentVersionId: string;
  /** What a person would call it: "your pitch deck, slide 6". */
  readonly label: string;
  readonly page: number | null;
  readonly text: string;
};

export type FounderExtractionRequest = {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  /** Passages from the founder's authorised documents. */
  readonly sources: readonly FounderExtractionSource[];
  /** What the founder typed, when anything. */
  readonly narrative: string | null;
  /** Facts already established, so they are neither re-asked nor re-extracted. */
  readonly knownFacts: readonly {
    readonly key: FounderFactKey;
    readonly value: string;
  }[];
  readonly unansweredKeys: readonly FounderFactKey[];
  readonly shape: BusinessShape | null;
  readonly stage: string | null;
  readonly signal?: AbortSignal | undefined;
};

/** The gateway seam, narrowed to what this needs. No provider is named. */
export type FounderExtractionGateway = {
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
    readonly latencyMs: number;
    readonly cost: { readonly amount: number };
    readonly output:
      | { readonly kind: "STRUCTURED"; readonly value: T }
      | { readonly kind: string };
  }>;
};

export type FounderExtractionDependencies = {
  readonly gateway: FounderExtractionGateway;
  readonly registry?: PromptRegistry | undefined;
  /**
   * How the material's sensitivity is declared to the gateway. A founder's
   * own deck is confidential; the gateway decides provider eligibility from
   * this BEFORE any provider is contacted, and a refusal is honoured rather
   * than worked around (§37, §45).
   */
  readonly sensitivity?: string | undefined;
  readonly budget?: unknown;
  readonly logger?: Logger | undefined;
};

/** Bounded: a prompt is not a corpus, and a slow onboarding is a failed one (§79). */
export const FOUNDER_EXTRACTION_MAX_PASSAGES = 40;
export const FOUNDER_EXTRACTION_MAX_PASSAGE_CHARS = 4_000;

/** A specific figure with nothing behind it: what general model knowledge produces. */
const SPECIFIC_ASSERTION = /\d/;

function emptyTelemetry(
  passageCount: number,
  documentCount: number,
): FounderExtractionTelemetry {
  return {
    promptBundleVersion: null,
    providerCode: null,
    modelCode: null,
    passageCount,
    documentCount,
    candidateCount: 0,
    conflictCount: 0,
    ambiguityCount: 0,
    rejectedCandidateCount: 0,
    rejectedCitationCount: 0,
    latencyMs: 0,
    costUsd: 0,
  };
}

export function createFounderExtraction(
  dependencies: FounderExtractionDependencies,
): {
  readonly extract: (
    request: FounderExtractionRequest,
  ) => Promise<FounderExtractionOutcome>;
} {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;

  return {
    extract: async (
      request: FounderExtractionRequest,
    ): Promise<FounderExtractionOutcome> => {
      const started = Date.now();
      const sources = request.sources.slice(0, FOUNDER_EXTRACTION_MAX_PASSAGES);
      const documentIds = new Set(sources.map((source) => source.documentId));
      const narrative = request.narrative?.trim() ?? "";

      if (sources.length === 0 && narrative.length === 0) {
        // Nothing to read is not a failure. It is the "Nothing yet" path,
        // and the journey continues by asking rather than extracting (§71).
        return {
          candidates: [],
          taxonomy: [],
          conflicts: [],
          ambiguities: [],
          missing: [...request.unansweredKeys],
          proposed: [],
          summary: "",
          blocked: "NO_MATERIAL",
          telemetry: emptyTelemetry(0, 0),
        };
      }

      // Labels are positional and per-render. They identify nothing outside
      // this call, and the map back to a document never leaves the server.
      const byLabel = new Map<string, FounderExtractionSource>();
      const passages: FounderSourcePassage[] = sources.map((source, index) => {
        const ref = `S${String(index + 1)}`;
        byLabel.set(ref, source);
        return {
          ref,
          label: source.label,
          text: source.text.slice(0, FOUNDER_EXTRACTION_MAX_PASSAGE_CHARS),
        };
      });

      const variables: Omit<
        FounderExtractionV2Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        founderNarrative:
          narrative.length === 0
            ? "The founder has not written a narrative; work from the supplied material alone."
            : narrative,
        knownFacts: request.knownFacts.map((fact) => ({
          key: fact.key,
          value: fact.value.slice(0, 1_000),
        })),
        sourcePassages: passages,
        unansweredKeys: [...request.unansweredKeys],
        businessShape: describeBusinessShape(request.shape, request.stage),
      };

      const rendered = renderPrompt<FounderExtractionV2Variables>(registry, {
        task: "FOUNDER_ONBOARDING_EXTRACTION",
        // Establishing what is true, before any advice (§31).
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot write anything, call anything, or change any permission. Everything you produce is reviewed by the founder before it is recorded.",
        variables,
      });

      let result: FounderExtractionV2Result | undefined;
      let telemetry = emptyTelemetry(passages.length, documentIds.size);
      let blocked: FounderExtractionOutcome["blocked"] = null;

      try {
        const response = await gateway.execute<FounderExtractionV2Result>(
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
            schema: FounderExtractionV2ResultSchema,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        telemetry = {
          ...telemetry,
          promptBundleVersion: rendered.bundle.bundleVersion,
          providerCode: response.providerCode,
          modelCode: response.modelCode,
          costUsd: response.cost.amount,
        };
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as { readonly value: FounderExtractionV2Result }
          ).value;
        } else {
          blocked = "MODEL_OUTPUT_REJECTED";
        }
      } catch (error: unknown) {
        const failureClass = (error as { failureClass?: string }).failureClass;
        // A policy refusal is Capital Q working: private material that no
        // configured provider may receive is not sent to a less suitable
        // one to keep the feature available (§45).
        blocked =
          failureClass === "POLICY_INELIGIBLE"
            ? "NO_ELIGIBLE_MODEL_ROUTE"
            : "MODEL_UNAVAILABLE";
        logger?.warn(
          {
            documents: documentIds.size,
            passages: passages.length,
            failureClass: failureClass ?? "UNKNOWN",
          },
          "founder onboarding extraction produced nothing",
        );
      }

      if (result === undefined) {
        return {
          candidates: [],
          taxonomy: [],
          conflicts: [],
          ambiguities: [],
          missing: [...request.unansweredKeys],
          proposed: [],
          summary: "",
          blocked: blocked ?? "MODEL_UNAVAILABLE",
          telemetry: { ...telemetry, latencyMs: Date.now() - started },
        };
      }

      let rejectedCandidates = 0;
      let rejectedCitations = 0;

      const resolve = (
        citations: readonly string[],
      ): readonly FounderSourceOrigin[] => {
        const origins: FounderSourceOrigin[] = [];
        const seen = new Set<string>();
        for (const citation of citations) {
          const source = byLabel.get(citation);
          if (source === undefined) {
            rejectedCitations += 1;
            continue;
          }
          if (seen.has(source.documentVersionId + String(source.page))) {
            continue;
          }
          seen.add(source.documentVersionId + String(source.page));
          origins.push({
            documentId: source.documentId,
            documentVersionId: source.documentVersionId,
            label: source.label,
            page: source.page,
          });
        }
        return origins;
      };

      const candidates: FounderCandidate[] = [];
      for (const candidate of result.candidates) {
        const origins = resolve(candidate.citations);
        const unsupported =
          origins.length === 0 &&
          candidate.quote === null &&
          SPECIFIC_ASSERTION.test(candidate.value);
        if (unsupported) {
          rejectedCandidates += 1;
          continue;
        }
        candidates.push({
          key: candidate.key,
          value: candidate.value,
          quote: candidate.quote,
          // The schema already excludes VERIFIED; this refuses it again so
          // the guarantee does not depend on one file staying correct.
          truthClass:
            candidate.truthClass === "USER_CLAIM" ||
            candidate.truthClass === "ESTIMATE" ||
            candidate.truthClass === "Q_INFERENCE"
              ? candidate.truthClass
              : "UNKNOWN",
          evidenceStatus:
            candidate.evidenceStatus === "SELF_REPORTED"
              ? "SELF_REPORTED"
              : "NO_EVIDENCE",
          confidence: candidate.confidence,
          explicit: candidate.explicit,
          origins,
        });
      }

      const taxonomy: FounderTaxonomySuggestion[] =
        result.taxonomyCandidates.map((item) => ({
          label: item.label,
          origins: resolve(item.citations),
        }));

      const conflicts: FounderConflict[] = result.conflicts
        .map((conflict) => ({
          key: conflict.key,
          readings: conflict.readings.map((reading) => ({
            value: reading.value,
            origins: resolve(reading.citations),
          })),
          question: conflict.question,
        }))
        // A "conflict" with one side is not a conflict; it is a claim.
        .filter((conflict) => conflict.readings.length >= 2);

      const ambiguities: FounderAmbiguity[] = result.ambiguous.map((item) => ({
        key: item.key,
        question: item.question,
      }));

      telemetry = {
        ...telemetry,
        candidateCount: candidates.length,
        conflictCount: conflicts.length,
        ambiguityCount: ambiguities.length,
        rejectedCandidateCount: rejectedCandidates,
        rejectedCitationCount: rejectedCitations,
        latencyMs: Date.now() - started,
      };

      // Counts and codes. No value, no quote, no passage, no summary (§59).
      logger?.info(
        {
          documents: documentIds.size,
          passages: passages.length,
          candidates: candidates.length,
          conflicts: conflicts.length,
          ambiguities: ambiguities.length,
          rejectedCandidates,
          rejectedCitations,
          provider: telemetry.providerCode,
          promptBundleVersion: telemetry.promptBundleVersion,
        },
        "founder onboarding extraction completed",
      );

      return {
        candidates,
        taxonomy,
        conflicts,
        ambiguities,
        missing: result.missing,
        proposed: result.proposedQuestions,
        summary: result.summary,
        blocked: null,
        telemetry,
      };
    },
  };
}
