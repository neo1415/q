import { randomUUID } from "node:crypto";

import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  TaxonomyChoiceV3ResultSchema,
  type PromptRegistry,
  type TaxonomyChoiceV3Result,
  type TaxonomyChoiceV3Variables,
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
  /**
   * What else they said for the profile, one "field: their words" a line
   * (live check 2026-10-31: "recurring revenue" from a B2B investor read
   * as Consumer Subscription). Their words: read, never obeyed.
   */
  readonly context?: string | undefined;
  readonly candidates: readonly {
    readonly nodeId: string;
    readonly displayName: string;
    readonly vocabularyCode: string;
  }[];
}) => Promise<TaxonomyChoice | null>;

/**
 * The ids chosen, with `beyond`: their own words about the field that the
 * chosen ones do not hold (live check 2026-10-31: "40 lockers live in 12
 * towns" lost when read as "Paying customers"). The caller keeps `beyond`
 * only where it is their words as said.
 */
export type TaxonomyChoice = readonly string[] & {
  readonly beyond?: string | undefined;
};

/** The most categories one reading is offered (a small field's whole list). */
export const TAXONOMY_CHOICE_CANDIDATES_MAX = 80;
const CANDIDATES_MAX = TAXONOMY_CHOICE_CANDIDATES_MAX;

/** The id a candidate is shown to the model by: its place in the list. */
const idOf = (index: number): string => `c${String(index + 1)}`;

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
  /** Today, for times their words name; the clock by default. */
  readonly now?: (() => Date) | undefined;
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
      const rendered = renderPrompt<TaxonomyChoiceV3Variables>(registry, {
        task: "TAXONOMY_CHOICE",
        operatingMode: "CONTINUOUS_INTELLIGENCE",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        // A time they name ("close in Q1") is read against today.
        environmentNotes: `You are reading words, not answering anyone. Code decides what happens from your reading. Today's date is ${(dependencies.now ?? (() => new Date()))().toISOString().slice(0, 10)}.`,
        variables: {
          field: input.field.trim().slice(0, 200) || "Categories",
          // Opaque ids, never the real ones (live recheck 2026-10-30): a
          // 36-character node id the model must copy back, or an option key
          // that is a word they used ("follow"), is how a reading goes
          // wrong. Code maps each id back.
          candidates: candidates
            .map(
              (c, index) =>
                `${idOf(index)} | ${c.displayName.slice(0, 120)} | ${c.vocabularyCode.slice(0, 60)}`,
            )
            .join("\n"),
          phrase,
          sentence,
          context:
            (input.context ?? "").trim().slice(0, 1_200) || "Nothing else yet.",
        },
      });
      const response =
        await dependencies.gateway.execute<TaxonomyChoiceV3Result>(
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
          { schema: TaxonomyChoiceV3ResultSchema },
        );
      if (response.output.kind !== "STRUCTURED") {
        dependencies.logger?.warn(
          { task: "TAXONOMY_CHOICE", kind: response.output.kind },
          "category words not read: not a structured reading",
        );
        return null;
      }
      const parsed = TaxonomyChoiceV3ResultSchema.safeParse(
        (response.output as { readonly value: unknown }).value,
      );
      if (!parsed.success) {
        dependencies.logger?.warn(
          { task: "TAXONOMY_CHOICE" },
          "category words not read: the reading did not fit its schema",
        );
        return null;
      }
      // Only the offered candidates: reference data, never invented.
      const byId = new Map(
        candidates.map((c, index) => [idOf(index), c.nodeId] as const),
      );
      const said = [...new Set(parsed.data.chosen)];
      const chosen = said.flatMap((id) => {
        const nodeId = byId.get(id.trim().toLowerCase());
        return nodeId === undefined ? [] : [nodeId];
      });
      // What was read is on the record (live recheck 2026-10-30: "Benelux"
      // came back with nothing usable and left no trace). The ids the model
      // named, exactly as it gave them, and the offered ids they matched;
      // never the person's words or a category's name.
      dependencies.logger?.info(
        {
          task: "TAXONOMY_CHOICE",
          offered: candidates.length,
          named: said.length,
          kept: chosen.length,
          // Whether words beyond the chosen ones came back, and context was
          // given; never the words themselves.
          beyond: (parsed.data.beyond ?? "").trim().length > 0,
          withContext: (input.context ?? "").trim().length > 0,
          namedIds: said.slice(0, 16).map((id) => id.slice(0, 64)),
          keptIds: said
            .map((id) => id.trim().toLowerCase())
            .filter((id) => byId.has(id))
            .slice(0, 16),
        },
        chosen.length < said.length
          ? "category reading named ids that were not offered"
          : "category words read",
      );
      const beyond = parsed.data.beyond?.trim() ?? "";
      return beyond.length > 0 && chosen.length > 0
        ? Object.assign(chosen, { beyond: beyond.slice(0, 300) })
        : chosen;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, task: "TAXONOMY_CHOICE" },
        "category words not read",
      );
      return null;
    }
  };
}
