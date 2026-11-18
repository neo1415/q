import type {
  ModelAttribution,
  ModelBudget,
  ModelDataPosture,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PipelineColumnMappingResultSchema,
  renderPrompt,
  type PipelineColumnMappingResult,
  type PipelineColumnMappingVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * Q's reading of an imported pipeline file's columns (owner decision 106):
 * the headers and a few short examples per column, never the rows. The
 * answer is a proposal: the caller keeps only a mapping whose every header
 * exists in the file, once, and falls back to the header-synonym mapping
 * otherwise. A failure is null, never a guess.
 */

const BUDGET: ModelBudget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 900,
  attemptTimeoutMs: 30_000,
};

const COLUMNS_MAX_CHARS = 11_000;

export type PipelineColumnMapper = {
  readonly propose: (input: {
    readonly side: "INVESTOR" | "COMPANY";
    readonly headers: readonly string[];
    readonly samples: readonly (readonly string[])[];
    readonly attribution: ModelAttribution;
  }) => Promise<Readonly<Partial<Record<string, string>>> | null>;
};

/** "Header | example; example", one line per column, bounded. */
export function pipelineColumnsText(
  headers: readonly string[],
  samples: readonly (readonly string[])[],
): string {
  const clean = (value: string) =>
    value
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  return headers
    .map(
      (header, index) =>
        `${clean(header)} | ${(samples[index] ?? []).map(clean).join("; ")}`,
    )
    .join("\n")
    .slice(0, COLUMNS_MAX_CHARS);
}

/** The model's list as {field: header}; the first answer for a field wins. */
export function pipelineMappingOf(
  result: PipelineColumnMappingResult,
): Readonly<Partial<Record<string, string>>> {
  const mapping: Record<string, string> = {};
  for (const entry of result.mappings) {
    mapping[entry.field] ??= entry.header;
  }
  return mapping;
}

export function createPipelineColumnMapper(dependencies: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** Doc 15 §62: absent is REAL_CUSTOMER. */
  readonly dataPosture?: ModelDataPosture | undefined;
}): PipelineColumnMapper {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return {
    propose: async (input) => {
      if (input.headers.length === 0) return null;
      const variables: Omit<
        PipelineColumnMappingVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        side: input.side,
        columns: pipelineColumnsText(input.headers, input.samples),
      };
      try {
        const rendered = renderPrompt<PipelineColumnMappingVariables>(
          registry,
          {
            task: "PIPELINE_COLUMN_MAPPING",
            operatingMode: "ASSESSMENT",
            communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
            environmentNotes:
              "You only map columns; you cannot read, write or confirm any row. The person reviews the import before anything is saved.",
            variables,
          },
        );
        const response = await gateway.execute<PipelineColumnMappingResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            reasoning: "LOW",
            // Someone's own pipeline: never to a provider ineligible for it.
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          { schema: PipelineColumnMappingResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = PipelineColumnMappingResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success ? pipelineMappingOf(parsed.data) : null;
      } catch (error: unknown) {
        logger.warn(
          { err: error },
          "a pipeline file's columns were not mapped by Q",
        );
        return null;
      }
    },
  };
}
