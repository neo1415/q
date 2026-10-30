import { randomUUID } from "node:crypto";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TaxonomyChoiceV2ResultSchema,
  type PromptRegistry,
  type TaxonomyChoiceV2Result,
  type TaxonomyChoiceV2Variables,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * A category word the deterministic taxonomy lookup found ambiguous,
 * chosen among the lookup's own candidates by meaning (production re-test
 * 2026-10-28: "health" matched Healthcare, Digital Health and Health
 * Access, abstained, and was never saved as a sector). TAXONOMY_MAPPING by
 * task class through the Model Gateway. It can only narrow the candidates
 * it is given: an id outside them is dropped. Null: not read (the caller
 * keeps the word in their words, as before).
 */
export type TaxonomyChooser = (input: {
  readonly who: { readonly tenantId: string; readonly userId: string | null };
  /** What the categories are for, in Capital Q's words. */
  readonly field: string;
  readonly phrase: string;
  readonly sentence: string;
  readonly candidates: readonly {
    readonly nodeId: string;
    readonly displayName: string;
    readonly vocabularyCode: string;
  }[];
}) => Promise<readonly string[] | null>;

/** The most categories one reading is offered (a small field's whole list). */
export const TAXONOMY_CHOICE_CANDIDATES_MAX = 80;
const CANDIDATES_MAX = TAXONOMY_CHOICE_CANDIDATES_MAX;

const CHOOSE = {
  maxAttempts: 1,
  maxEstimatedCostUsd: 0.006,
  maxOutputTokens: 600,
  attemptTimeoutMs: 6_000,
} as const;

export function createTaxonomyChooser(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
  readonly registry?: PromptRegistry | undefined;
}): TaxonomyChooser {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  return async (input) => {
    // The lookup's candidates, or a small field's whole list when the
    // lookup found none (sweep 2026-10-29: "Benelux"): bounded either way.
    const candidates = input.candidates.slice(0, CANDIDATES_MAX);
    const phrase = input.phrase.trim().slice(0, 200);
    if (candidates.length === 0 || phrase.length === 0) return null;
    const sentence = (input.sentence.trim() || phrase).slice(0, 1_000);
    try {
      const rendered = renderPrompt<TaxonomyChoiceV2Variables>(registry, {
        task: "TAXONOMY_CHOICE",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You are reading words, not answering anyone. Code decides what happens from your reading.",
        variables: {
          field: input.field.trim().slice(0, 200) || "Categories",
          candidates: candidates
            .map(
              (c) =>
                `${c.nodeId} | ${c.displayName.slice(0, 120)} | ${c.vocabularyCode.slice(0, 60)}`,
            )
            .join("\n"),
          phrase,
          sentence,
        },
      });
      const response =
        await dependencies.gateway.execute<TaxonomyChoiceV2Result>(
          {
            taskClass: "TAXONOMY_MAPPING",
            sensitivity: "CONFIDENTIAL",
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            budget: CHOOSE,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              tenantId: input.who.tenantId,
              ...(input.who.userId === null
                ? {}
                : { userId: input.who.userId }),
              correlationId: `cor_${randomUUID()}`,
            },
          },
          { schema: TaxonomyChoiceV2ResultSchema },
        );
      if (response.output.kind !== "STRUCTURED") return null;
      const parsed = TaxonomyChoiceV2ResultSchema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      if (!parsed.success) return null;
      // Only the lookup's own candidates: reference data, never invented.
      const offered = new Set(candidates.map((c) => c.nodeId));
      return [...new Set(parsed.data.chosen)].filter((id) => offered.has(id));
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, task: "TAXONOMY_CHOICE" },
        "category words not read",
      );
      return null;
    }
  };
}
