import { z } from "zod";

/**
 * Approval card upgrade (QA lead 2026-10-24): why Q proposes it, shown on
 * the card as "Why: …". The model's own sentence, from what it read; the
 * action's own reason wins where the action has one. Presentation only:
 * never part of what the approval binds to.
 */
export const CardReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe(
    "One sentence on why this is worth doing for them, from what you read in their records (shown on the card as 'Why: …'), e.g. 'Seed, Kenya and water all match your published mandate.' Leave it out when you have no grounded reason; never invent one.",
  );

/** The reason a tool's input carried, if any. */
export function reasonOf(input: unknown): string | undefined {
  const value =
    input !== null && typeof input === "object"
      ? (input as { readonly reason?: unknown }).reason
      : undefined;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}
