import type {
  CorrelationId,
  ModelSensitivity,
  QArtifactContent,
} from "@capital-q/contracts";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type ArtifactRevisionResult,
  type ArtifactRevisionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import { ArtifactRevisionResultSchema } from "@capital-q/q-core";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  applyRevisedBodies,
  type ComposedInvestmentBrief,
} from "./investment-brief.js";

/**
 * "Edit with Q", as a model task (QX-003F; ADR 0013).
 *
 * The same shape as the recommendation narrator: a governed model call
 * over material the caller already authorised, producing wording and
 * nothing else. It holds no repository, reads no record and persists
 * nothing — the artifact application service does that, after this has
 * returned.
 *
 * What it is given is deliberately thin: the document's own headings and
 * prose, and the person's instruction. There is no company record in the
 * prompt, so there is nothing in it to draw a new claim from, and every
 * rewritten body is checked against the record's figures before it is
 * accepted. A revision that tried to add traction produces the original
 * paragraph instead.
 */

export type BriefReviser = {
  readonly revise: (input: {
    readonly base: ComposedInvestmentBrief;
    /** The person's own words. UNTRUSTED: data, never authority. */
    readonly instruction: string;
    /** What the record carries, for the figure check. */
    readonly grounding: readonly string[];
    readonly sensitivity: ModelSensitivity;
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly qRunId: string;
      readonly correlationId: CorrelationId;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<ComposedInvestmentBrief>;
};

/** The document as the prompt sees it: headings and prose, nothing else. */
function renderDocument(content: QArtifactContent): string {
  return content.sections
    .map((section) => `## ${section.heading}\n${section.body}`)
    .join("\n\n")
    .slice(0, 40_000);
}

export function createBriefReviser(dependencies: {
  readonly gateway: ModelGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger?: Logger | undefined;
}): BriefReviser {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return {
    revise: async (input) => {
      const rendered = renderPrompt<ArtifactRevisionVariables>(registry, {
        task: "ARTIFACT_REVISION",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are rewriting prose only. No record, no evidence and no tools are available to you, and any figure you add that the document does not already carry will be discarded.",
        variables: {
          instruction: input.instruction,
          document: renderDocument(input.base.content),
        },
      });

      let result: ArtifactRevisionResult | undefined;
      try {
        const executed =
          await dependencies.gateway.execute<ArtifactRevisionResult>(
            {
              taskClass: "NORMAL_DIALOGUE",
              budget: budgetForTaskClass("NORMAL_DIALOGUE"),
              sensitivity: input.sensitivity,
              messages: [...rendered.messages],
              output: rendered.output,
              attribution: input.attribution,
            },
            {
              schema: ArtifactRevisionResultSchema,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            },
          );
        if (executed.output.kind === "STRUCTURED") {
          result = executed.output.value;
        }
      } catch (error: unknown) {
        // A revision that could not be composed is not a damaged document.
        // The caller still writes a version, and it reads as it did.
        dependencies.logger?.warn(
          {
            err: isModelGatewayError(error) ? error.failureClass : "unknown",
          },
          "artifact revision model call did not complete",
        );
      }

      if (result === undefined) {
        return input.base;
      }

      const revised = new Map<string, string>();
      const headings = new Set(
        input.base.content.sections.map((section) => section.heading),
      );
      for (const section of result.sections) {
        // A heading the document does not have is a section the model
        // invented, and it is dropped rather than appended.
        if (headings.has(section.heading)) {
          revised.set(section.heading, section.body);
        }
      }
      return applyRevisedBodies({
        base: input.base,
        revised,
        grounding: input.grounding,
      });
    },
  };
}
