import {
  DECK_SECTIONS,
  type DeckSectionReading,
  type ModelAttribution,
  type ModelBudget,
  type ModelDataPosture,
} from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  DeckExtractionResultSchema,
  renderPrompt,
  type DeckExtractionResult,
  type DeckExtractionVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * Q reads a pitch deck into the twelve standard sections (overnight plan
 * A5). Its only input is that version's own extracted text, slide by slide
 * (Context Firewall): nothing else Q knows about the company reaches the
 * reading, because investors may later see it beside that deck. A failure
 * is null; the deck tab then shows the deck without Q's sections.
 */

/** Characters of deck text sent: a 20-slide deck fits with room to spare. */
export const DECK_READER_TEXT_MAX = 40_000;
/** The prompt family version whose output is stored. */
export const DECK_READER_PROMPT_VERSION = 1;

const BUDGET: ModelBudget = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.25,
  maxOutputTokens: 6_000,
  attemptTimeoutMs: 120_000,
};

export type DeckPassage = {
  readonly content: string;
  /** The slide or first page this passage comes from, when known. */
  readonly slide: number | null;
};

export type DeckReader = {
  readonly read: (input: {
    readonly title: string;
    readonly pages: number | null;
    readonly passages: readonly DeckPassage[];
    readonly attribution: ModelAttribution;
  }) => Promise<readonly DeckSectionReading[] | null>;
};

/** The text as sent: "[Slide N]" before each slide's passages, bounded. */
export function deckText(passages: readonly DeckPassage[]): string {
  const lines: string[] = [];
  let current: number | null = null;
  for (const passage of passages) {
    const content = passage.content.replace(/\s+/g, " ").trim();
    if (content.length === 0) continue;
    if (passage.slide !== null && passage.slide !== current) {
      current = passage.slide;
      lines.push(`[Slide ${String(current)}]`);
    }
    lines.push(content);
  }
  return lines.join("\n").slice(0, DECK_READER_TEXT_MAX);
}

/**
 * Whatever the model returned, as twelve sections in order: a missing
 * section is NOT_IN_DECK; a duplicate keeps the first; a slide number past
 * the deck's end is dropped (never a citation to a page that is not there).
 */
export function normaliseDeckReading(
  result: DeckExtractionResult,
  pages: number | null,
): DeckSectionReading[] {
  const inDeck = (page: number) => pages === null || page <= pages;
  return DECK_SECTIONS.map((code) => {
    const found = result.sections.find((section) => section.section === code);
    if (found === undefined) {
      return {
        section: code,
        status: "NOT_IN_DECK",
        summary: null,
        pages: [],
        facts: [],
        confidence: "LOW",
        criteria: {
          clear: false,
          strong: false,
          exceptional: false,
          note: null,
        },
      };
    }
    const notCovered = found.status === "NOT_IN_DECK";
    return {
      ...found,
      // Nothing in a section the deck does not cover can be "met".
      summary: notCovered ? null : found.summary,
      pages: found.pages.filter(inDeck),
      facts: found.facts.map((fact) => ({
        ...fact,
        pages: fact.pages.filter(inDeck),
        // Unknown has no value; a value is never also unknown.
        unknownReason:
          fact.value === null ? (fact.unknownReason ?? "NOT_IN_DECK") : null,
      })),
      criteria: notCovered
        ? {
            clear: false,
            strong: false,
            exceptional: false,
            note: found.criteria.note,
          }
        : {
            ...found.criteria,
            strong: found.criteria.clear && found.criteria.strong,
            exceptional:
              found.criteria.clear &&
              found.criteria.strong &&
              found.criteria.exceptional,
          },
    };
  });
}

export function createDeckReader(dependencies: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  /** Doc 15 §62: absent is REAL_CUSTOMER. */
  readonly dataPosture?: ModelDataPosture | undefined;
}): DeckReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return {
    read: async (input) => {
      const text = deckText(input.passages);
      if (text.length === 0) return null;
      const variables: Omit<
        DeckExtractionVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = { title: input.title.slice(0, 200), pages: input.pages, text };
      try {
        const rendered = renderPrompt<DeckExtractionVariables>(registry, {
          task: "DECK_EXTRACTION",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes:
            "You file a deck into twelve sections for the founder to confirm; investors see it only after that.",
          variables,
        });
        const response = await gateway.execute<DeckExtractionResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            reasoning: "LOW",
            // A founder's deck: never to a provider ineligible for it.
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          { schema: DeckExtractionResultSchema },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = DeckExtractionResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        return parsed.success
          ? normaliseDeckReading(parsed.data, input.pages)
          : null;
      } catch (error: unknown) {
        logger.warn({ err: error }, "a pitch deck was not read");
        return null;
      }
    },
  };
}
