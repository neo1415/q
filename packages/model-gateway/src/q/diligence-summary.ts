import type {
  ModelAttribution,
  ModelBudget,
  ModelDataPosture,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DiligenceDocumentSummaryResultSchema,
  renderPrompt,
  type DiligenceDocumentSummaryResult,
  type DiligenceDocumentSummaryVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * Q's one line on a document a founder shared in diligence (founder critique
 * 2026-10-04), for the investor who asked for it. Its only input is that
 * version's own extracted text: the reader may open exactly that file, so
 * nothing else Q knows about the company can reach the line (Context
 * Firewall). A failure is null; the card then shows the file without one.
 */

/** Characters of extracted text sent: a deck or accounts read from the top. */
export const DILIGENCE_SUMMARY_TEXT_MAX = 24_000;
/** Stored and shown; the database holds at most 240. */
const SUMMARY_MAX = 200;

const BUDGET: ModelBudget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 300,
  attemptTimeoutMs: 45_000,
};

export type DiligenceDocumentSummariser = {
  readonly summarise: (input: {
    readonly title: string;
    readonly pages: number | null;
    /** The version's passages, in reading order. */
    readonly passages: readonly string[];
    readonly attribution: ModelAttribution;
  }) => Promise<string | null>;
};

/** The text as sent: passages in order, whitespace folded, bounded. */
export function summaryText(passages: readonly string[]): string {
  return passages
    .map((passage) => passage.replace(/\s+/g, " ").trim())
    .filter((passage) => passage.length > 0)
    .join("\n")
    .slice(0, DILIGENCE_SUMMARY_TEXT_MAX);
}

/** One clean line: no control characters, bounded, or null. */
export function summaryLine(
  result: DiligenceDocumentSummaryResult,
): string | null {
  const line = result.summary
    ?.replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return line === undefined || line.length < 3
    ? null
    : line.slice(0, SUMMARY_MAX);
}

export function createDiligenceDocumentSummariser(dependencies: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** Doc 15 §62: absent is REAL_CUSTOMER. */
  readonly dataPosture?: ModelDataPosture | undefined;
}): DiligenceDocumentSummariser {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return {
    summarise: async (input) => {
      const text = summaryText(input.passages);
      if (text.length === 0) return null;
      const variables: Omit<
        DiligenceDocumentSummaryVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        title: input.title.slice(0, 200),
        pages: input.pages,
        text,
      };
      try {
        const rendered = renderPrompt<DiligenceDocumentSummaryVariables>(
          registry,
          {
            task: "DILIGENCE_DOCUMENT_SUMMARY",
            operatingMode: "ASSESSMENT",
            communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
            environmentNotes:
              "You write one line and nothing else; it is shown labelled as Q's summary beside the file.",
            variables,
          },
        );
        const response = await gateway.execute<DiligenceDocumentSummaryResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            reasoning: "LOW",
            // A founder's document: never to a provider ineligible for it.
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          { schema: DiligenceDocumentSummaryResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = DiligenceDocumentSummaryResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success ? summaryLine(parsed.data) : null;
      } catch (error: unknown) {
        logger.warn({ err: error }, "a diligence document was not summarised");
        return null;
      }
    },
  };
}
