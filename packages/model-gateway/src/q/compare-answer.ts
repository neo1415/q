import type { ModelOutputSpec } from "@capital-q/contracts";
import {
  CompanyAnalystV26ResultSchema,
  type CompanyAnalystV26Result,
} from "@capital-q/q-core";
import { z } from "zod";

import { containsCompanyName } from "./card-subjects.js";
import type { ComparisonVerdict } from "./compare-table.js";

/**
 * Coordinator 2026-10-26 (live run 0adc1c1e, "How do the top two stack
 * up?" in the same conversation as the top five): code's table and
 * verdict were on screen at 2.7 s, and the person then waited 12.8 s for
 * one writer that spent 1,424 output tokens, most of them on fields that
 * restate the table (findings, cards) or cannot apply to a comparison
 * (profile updates, documents, pictures). The model emits every field the
 * schema requires, so the time is the schema's.
 *
 * When code resolved the comparison, the writer is asked only for the
 * fields that carry its own judgement; the rest are filled by code with
 * their empty values, exactly what the turn kept from them before (I21:
 * the table, verdict, cards and pictures are code's).
 */
export const COMPARE_ANSWER_FIELDS = [
  "answer",
  "responseShape",
  "missingEvidence",
  "contradictions",
  "insufficientEvidence",
  "clarifyingQuestions",
  "declined",
  "actionTalk",
] as const;

/**
 * An analyst output spec narrowed to `fields`, all required: the model
 * writes only those (the strict schema otherwise makes it emit every
 * field, and every token is time the person waits).
 */
export function narrowedOutput(
  output: ModelOutputSpec,
  fields: readonly string[],
): ModelOutputSpec {
  if (output.kind !== "STRUCTURED") return output;
  const schema = output.jsonSchema as {
    readonly properties?: Readonly<Record<string, unknown>>;
  };
  const properties = schema.properties ?? {};
  const kept = fields.filter((field) => field in properties);
  return {
    ...output,
    jsonSchema: {
      ...output.jsonSchema,
      properties: Object.fromEntries(
        kept.map((field) => [field, properties[field]]),
      ),
      required: [...kept],
    },
  };
}

/** An analyst output spec without `fields` (the rest kept, all required). */
export function outputWithout(
  output: ModelOutputSpec,
  fields: readonly string[],
): ModelOutputSpec {
  if (output.kind !== "STRUCTURED") return output;
  const schema = output.jsonSchema as {
    readonly properties?: Readonly<Record<string, unknown>>;
  };
  const left = new Set(fields);
  return narrowedOutput(
    output,
    Object.keys(schema.properties ?? {}).filter((field) => !left.has(field)),
  );
}

/**
 * Production 2026-10-26 (run 7b51d28d, "How investor-ready is my company
 * right now?"): the conversation writer's one round wrote 2,457 tokens in
 * 19.9 s, fields nobody reads among them.
 *
 * - The company specialist's own channels (companyFindings, coverage,
 *   materialChanges) are never shown in conversation; the turn's note
 *   already says to leave them out. Asked for them no more, the model's
 *   points can only go to `findings`, which is shown.
 * - When the extras' writer writes the findings and cards beside the
 *   answer, the answer's writer is not asked for them as well.
 *
 * Everything else, the person's own statements and changes included, is
 * asked for as before.
 */
export const SPECIALIST_ONLY_FIELDS = [
  "companyFindings",
  "coverage",
  "materialChanges",
] as const;
export const EXTRAS_WRITE_FIELDS = [
  "findings",
  "answerCards",
  "comparisonCards",
] as const;

/** The conversation writer's spec: what it alone writes, and is shown. */
export function conversationAnswerOutput(
  output: ModelOutputSpec,
  extrasWriteBeside: boolean,
): ModelOutputSpec {
  return outputWithout(output, [
    ...SPECIALIST_ONLY_FIELDS,
    ...(extrasWriteBeside ? EXTRAS_WRITE_FIELDS : []),
  ]);
}

/** The analyst's output spec, narrowed to the comparison's own fields. */
export function compareAnswerOutput(output: ModelOutputSpec): ModelOutputSpec {
  return narrowedOutput(output, COMPARE_ANSWER_FIELDS);
}

/**
 * The analyst's result schema for a writer asked for some fields only:
 * what it was not asked for is filled by code before the usual checks.
 * Only `recommendation` has no default of its own; every other field left
 * out takes its schema's empty value.
 */
export const NARROWED_ANALYST_SCHEMA: z.ZodType<CompanyAnalystV26Result> =
  z.preprocess(
    (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { recommendation: null, ...(value as Record<string, unknown>) }
        : value,
    CompanyAnalystV26ResultSchema,
  );

/** The comparison's writer's schema (see NARROWED_ANALYST_SCHEMA). */
export const COMPARE_ANSWER_SCHEMA = NARROWED_ANALYST_SCHEMA;

/**
 * Whether one of the writer's sentences only says code's verdict again
 * (live run 0adc1c1e: "Dawaledger and Marketlight Grids are level on
 * Capital Q's mandate fit, at 7.6 each. Dawaledger and Marketlight Grids
 * are level on mandate fit at 7.6 each."). Read from the verdict's own
 * facts, never from words: the sentence names both companies, carries each
 * of the verdict's scores, and is no longer than the verdict says it plus
 * a clause. A sentence that adds anything of its own is longer, and stays.
 */
export function restatesVerdict(
  sentence: string,
  verdict: ComparisonVerdict,
): boolean {
  const scores = new Set([verdict.leaderScore, verdict.otherScore]);
  const numbers = new Set(sentence.match(/\d+(?:\.\d+)?/gu) ?? []);
  return (
    containsCompanyName(sentence, verdict.leader) &&
    containsCompanyName(sentence, verdict.other) &&
    [...scores].every((score) => numbers.has(score)) &&
    [...numbers].every((number) => scores.has(number)) &&
    sentence.trim().length <=
      verdict.leader.length + verdict.other.length + VERDICT_CLAUSE_CHARS
  );
}

/** Room for "X and Y are level on mandate fit, at 7.6 each" and its kin. */
const VERDICT_CLAUSE_CHARS = 90;
