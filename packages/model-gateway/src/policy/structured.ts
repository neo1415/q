import type { z } from "zod";

/**
 * Structured output acceptance (doc 12 §27; packet §32).
 *
 *   provider text → JSON decode → Zod validation → typed value
 *
 * Provider JSON that parses is not yet data. Only what the caller's Zod
 * schema accepts is returned; anything else is INVALID_MODEL_OUTPUT and
 * is never persisted. Code fences are tolerated because models emit them
 * despite instructions; nothing else is "repaired".
 */

export type StructuredOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      /** Which stage refused: a bounded reason, never the model text. */
      readonly stage: "JSON" | "SCHEMA";
    };

const FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i;

export function acceptStructuredOutput<T>(
  text: string,
  schema: z.ZodType<T>,
): StructuredOutcome<T> {
  const fenced = FENCE.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    return { ok: false, stage: "JSON" };
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, stage: "SCHEMA" };
}
