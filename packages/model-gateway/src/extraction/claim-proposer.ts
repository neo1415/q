import type { ModelSensitivity } from "@capital-q/contracts";
import type {
  ClaimProposal,
  ClaimProposalBatch,
  ClaimProposerPort,
} from "@capital-q/evidence";
import {
  ClaimProposalBlockedError,
  CLAIM_EXTRACTION_PIPELINE_VERSION,
} from "@capital-q/evidence";
import type { Logger } from "@capital-q/observability";
import {
  ClaimExtractionResultSchema,
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ClaimExtractionResult,
  type ClaimExtractionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import { isModelGatewayError } from "../errors.js";
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
        schema: ClaimExtractionResultSchema,
        ...(signal === undefined ? {} : { signal }),
      };

      let result;
      try {
        result = await gateway.execute<ClaimExtractionResult>(request, options);
      } catch (error: unknown) {
        // A refusal on sensitivity is a policy answer, not an outage, and
        // the answer is "not this material". Re-declaring the passage as
        // less sensitive so a provider would accept it is the one thing
        // this file must never do, so there is no branch that does.
        throw new ClaimProposalBlockedError(
          isModelGatewayError(error) &&
            error.failureClass === "POLICY_INELIGIBLE"
            ? "PROVIDER_INELIGIBLE"
            : "PROVIDER_UNAVAILABLE",
        );
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
      const proposals: ClaimProposal[] = extracted.claims.map((claim) => ({
        claimKey: claim.claimKey,
        statement: claim.statement,
        value: claim.value,
        assertionKind: claim.assertionKind,
        excerpt: claim.excerpt,
        ...(claim.locator === undefined ? {} : { locatorHint: claim.locator }),
        asOf: claim.asOf,
      }));
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
