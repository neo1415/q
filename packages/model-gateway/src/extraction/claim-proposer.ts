import type { ModelDataPosture, ModelSensitivity } from "@capital-q/contracts";
import type {
  ClaimProposal,
  ClaimProposalBatch,
  ClaimProposerPort,
} from "@capital-q/evidence";
import {
  ClaimProposalBlockedError,
  CLAIM_EXTRACTION_PIPELINE_VERSION,
  statedFigurePeriod,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  ClaimExtractionResultV2Schema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ClaimExtractionResultV2,
  type ClaimExtractionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import { isModelGatewayError, isModelServiceUnavailable } from "../errors.js";
import type { ModelGateway } from "../gateway.js";
import { budgetForTaskClass } from "../q/index.js";

/**
 * The model-backed claim proposer (CQ-KNW-001 §9, §12, §14, §27).
 *
 * This is the only place in the claim path that knows a model exists. It
 * renders the registered CLAIM_EXTRACTION prompt, sends it through the Model
 * Gateway with the task's own schema as the acceptance test, and hands
 * Evidence a batch of proposals. It writes nothing, reads no database, and
 * has no way to persist anything even if the model asked it to.
 *
 * Provider eligibility is the gateway's, decided from the declared
 * sensitivity before any provider is called (§14). The sensitivity declared
 * here is the SOURCE's, not a convenient default: a founder-private passage
 * is offered as founder-private, and if no configured provider may receive
 * that class the request fails rather than quietly downgrading. There is no
 * branch in this file that lowers it.
 */

export type ModelClaimProposerDependencies = {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
  /** Whether the material is a real customer's (default) or invented demo data. */
  readonly dataPosture?: ModelDataPosture | undefined;
};

/** A passage's sensitivity, as the caller resolved it from the source row. */
export type ClaimProposerSensitivityPolicy = {
  readonly sensitivityFor: (passage: {
    readonly sourceId: string;
  }) => Promise<ModelSensitivity>;
};

export function createModelClaimProposer(
  dependencies: ModelClaimProposerDependencies & {
    readonly sensitivity: ClaimProposerSensitivityPolicy;
  },
): ClaimProposerPort {
  const { gateway, sensitivity, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();

  return {
    propose: async ({ passage, claimKeys, actor, signal }) => {
      const variables: Omit<
        ClaimExtractionVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        sourceDescription: passage.description,
        // The permitted keys are trusted server text. A key absent from
        // this list is refused later whatever the model returns, so this is
        // guidance rather than the control.
        permittedClaimKeys: [...claimKeys].sort().join(", "),
        passage: passage.text,
        passageLocator: describeLocator(passage.locator),
      };
      const rendered = renderPrompt<ClaimExtractionVariables>(registry, {
        task: "CLAIM_EXTRACTION",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are proposing candidates for deterministic validation. Nothing you return is stored as written, and the fields that decide truth, verification, permission and sensitivity are not yours to set.",
        variables,
      });

      const declared = await sensitivity.sensitivityFor({
        sourceId: passage.sourceId,
      });
      const request = {
        taskClass: rendered.taskClass,
        sensitivity: declared,
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
        messages: [...rendered.messages],
        output: rendered.output,
        budget: budgetForTaskClass(rendered.taskClass),
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          correlationId: passage.sourceId,
        },
      };
      const options = {
        schema: ClaimExtractionResultV2Schema,
        // Each claim is an independent reading: one the schema refuses (a
        // malformed date, a key off the list) is dropped and reported, and
        // the others are kept (A8 live 2026-11-14: three month-dated
        // figures refused the whole batch).
        invalidListItems: "DROP" as const,
        ...(signal === undefined ? {} : { signal }),
      };

      let result;
      try {
        result = await gateway.execute<ClaimExtractionResultV2>(
          request,
          options,
        );
      } catch (error: unknown) {
        // A refusal on sensitivity is a policy answer, not an outage, and
        // the answer is "not this material". Re-declaring the passage as
        // less sensitive so a provider would accept it is the one thing
        // this file must never do, so there is no branch that does.
        throw blockedFor(error);
      }

      const provenance = {
        pipelineVersion: CLAIM_EXTRACTION_PIPELINE_VERSION,
        proposerKind: "MODEL" as const,
        promptVersionId: rendered.bundle.task,
        providerCode: result.providerCode,
        modelCode: result.modelCode,
      };

      if (result.output.kind !== "STRUCTURED") {
        // The gateway accepts structured output only through the schema
        // above; anything else is not a partially usable answer.
        logger?.warn(
          {
            sourceId: passage.sourceId,
            promptVersionId: provenance.promptVersionId,
          },
          "claim extraction returned no structured output",
        );
        return { proposals: [], absent: [...claimKeys], provenance };
      }

      const extracted = result.output.value;
      const dropped = result.output.dropped ?? [];
      if (dropped.length > 0) {
        // Paths and codes only: never a value the model wrote.
        logger?.warn(
          {
            sourceId: passage.sourceId,
            promptVersionId: provenance.promptVersionId,
            dropped,
          },
          "claim extraction kept; refused claims were dropped",
        );
      }
      const proposals: ClaimProposal[] = extracted.claims.flatMap((claim) => {
        // A month is dated at its end, by code; a day is itself. A shape
        // the schema let through but no calendar has is dropped, never
        // re-dated.
        const asOf =
          claim.asOf === null ? null : statedFigurePeriod(claim.asOf).asOf;
        if (claim.asOf !== null && asOf === null) return [];
        return [
          {
            claimKey: claim.claimKey,
            statement: claim.statement,
            value: claim.value,
            assertionKind: claim.assertionKind,
            excerpt: claim.excerpt,
            ...(claim.locator === undefined
              ? {}
              : { locatorHint: claim.locator }),
            asOf,
          },
        ];
      });
      const produced = new Set(proposals.map((p) => p.claimKey));
      return {
        proposals,
        // Trust the server's list over the model's: a key the model forgot
        // to mention absent is still absent, and a key it invented is not.
        absent: claimKeys.filter(
          (key) => !produced.has(key) || extracted.absent.includes(key),
        ),
        provenance,
      } satisfies ClaimProposalBatch;
    },
  };
}

/**
 * What actually stopped the proposer, said as it is (A8 live 2026-11-14:
 * an answer the schema refused was reported as "no eligible provider").
 * The refusals are field paths and schema codes, never model text.
 */
export function blockedFor(error: unknown): ClaimProposalBlockedError {
  if (!isModelGatewayError(error)) {
    return new ClaimProposalBlockedError("PROVIDER_UNAVAILABLE");
  }
  const detail = {
    failureClass: error.failureClass,
    refusals: error.refusals ?? [],
  };
  if (isModelServiceUnavailable(error)) {
    return new ClaimProposalBlockedError("PROVIDER_UNAVAILABLE", detail);
  }
  if (error.failureClass === "POLICY_INELIGIBLE") {
    return new ClaimProposalBlockedError("PROVIDER_INELIGIBLE", detail);
  }
  if (error.failureClass === "INVALID_MODEL_OUTPUT") {
    return new ClaimProposalBlockedError("SCHEMA_REFUSED", detail);
  }
  return new ClaimProposalBlockedError("MODEL_FAILED", detail);
}

/** Trusted, human-readable, never a storage path or a signed URL. */
function describeLocator(locator: {
  readonly kind: string;
  readonly page?: number | undefined;
  readonly sheet?: string | undefined;
  readonly cell?: string | undefined;
}): string {
  if (locator.kind !== "document") {
    return "a direct statement";
  }
  const parts: string[] = [];
  if (locator.page !== undefined) {
    parts.push(`page ${String(locator.page)}`);
  }
  if (locator.sheet !== undefined) {
    parts.push(`sheet ${locator.sheet}`);
  }
  if (locator.cell !== undefined) {
    parts.push(`cell ${locator.cell}`);
  }
  return parts.length === 0
    ? "a document this organisation holds"
    : `a document this organisation holds, ${parts.join(", ")}`;
}
