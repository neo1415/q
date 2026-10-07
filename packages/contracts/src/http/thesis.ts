import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * Q.02 "Learns how each investor thinks" (2026-10-07): "How Q reads your
 * thesis". Three things kept apart, never merged:
 *
 *   declared  the investor's own mandate rules (authoritative; the feed's)
 *   observed  what they did: their own saves and passes, counted
 *   inferred  Q's reading of the gap between the two, labelled Q_INFERENCE
 *
 * Observed behaviour never rewrites the declared mandate. A suggestion is
 * a proposed mandate edit that applies only when the investor approves it
 * (the existing mandate update, at the version they read). Viewing counts
 * for nothing here; saving is not interest. Computed in code, no model.
 */

export const ThesisDeclaredRuleSchema = z
  .object({
    /** "Stage", "Countries", "Sectors", "Cheque", "Never". */
    label: z.string().min(1).max(40),
    value: z.string().min(1).max(300),
  })
  .strict();

export const ThesisObservedCountSchema = z
  .object({
    decision: z.enum(["SAVED", "PASSED"]),
    dimension: z.enum(["STAGE", "COUNTRY"]),
    /** The machine value (a stage code or ISO country code). */
    value: z.string().min(1).max(64),
    /** Its words ("Seed", "Ghana"). */
    label: z.string().min(1).max(80),
    count: z.number().int().min(1),
  })
  .strict();
export type ThesisObservedCount = z.infer<typeof ThesisObservedCountSchema>;

export const ThesisSuggestionSchema = z
  .object({
    /** Stable for the same evidence: `ADD_COUNTRY:GH`, `DROP_STAGE:pre_seed`. */
    id: z
      .string()
      .regex(/^(ADD_COUNTRY|DROP_STAGE):[A-Za-z0-9_]{1,64}$/),
    kind: z.enum(["ADD_COUNTRY", "DROP_STAGE"]),
    /** The code added or dropped. */
    value: z.string().min(1).max(64),
    title: z.string().min(1).max(120),
    /** Why, from their own decisions, in words. */
    because: z.string().min(1).max(240),
    /** What would change in their feed if they approve. */
    effect: z.string().min(1).max(240),
    truthClass: z.literal("Q_INFERENCE"),
  })
  .strict();
export type ThesisSuggestion = z.infer<typeof ThesisSuggestionSchema>;

export const ThesisReadingDtoSchema = z
  .object({
    /** The active mandate read; null: none (nothing declared yet). */
    mandateId: UuidSchema.nullable(),
    /** The version the suggestions were computed against. */
    mandateVersion: z.number().int().min(1).nullable(),
    declared: z.array(ThesisDeclaredRuleSchema).max(12),
    observed: z
      .object({
        saved: z.number().int().min(0),
        passed: z.number().int().min(0),
        counts: z.array(ThesisObservedCountSchema).max(24),
      })
      .strict(),
    /** Q's reading, in sentences; each is an inference, never a rule. */
    inferred: z.array(z.string().min(1).max(240)).max(4),
    suggestions: z.array(ThesisSuggestionSchema).max(4),
    computedAt: UtcTimestampSchema,
  })
  .strict();
export type ThesisReadingDto = z.infer<typeof ThesisReadingDtoSchema>;

/** `GET /v1/fit/thesis` — the investor's own reading (Q API). */
export const FIT_THESIS_PATH = "/v1/fit/thesis" as const;

/**
 * `POST …/mandates/:mandateId/suggestions/:suggestionId/apply` — the
 * investor approves one suggestion; it becomes the ordinary mandate
 * update at the version they read (a changed mandate is a conflict, never
 * a silent overwrite).
 */
export const MANDATE_SUGGESTION_APPLY_PATH =
  "/v1/investors/:investorOrganisationId/mandates/:mandateId/suggestions/:suggestionId/apply" as const;

export const ApplyThesisSuggestionRequestSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();
export type ApplyThesisSuggestionRequest = z.infer<
  typeof ApplyThesisSuggestionRequestSchema
>;

export const ThesisSuggestionIdSchema = z
  .string()
  .regex(/^(ADD_COUNTRY|DROP_STAGE):[A-Za-z0-9_]{1,64}$/);
