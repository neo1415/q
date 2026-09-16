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
      /**
       * Which fields the schema refused and why, as field paths and Zod's
       * own codes. Never a value the model wrote, so this is safe to log
       * and is the difference between "the model is wrong" and "we are
       * asking for something this model cannot produce". Bounded.
       */
      readonly refusals?: readonly string[];
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
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    stage: "SCHEMA",
    refusals: parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "(root)"}:${issue.code}`),
  };
}
