import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";

/**
 * What Q remembers about the person (ADR 0012), for them to read and
 * correct (founder live 2026-09-29: "if I tell it something I don't want
 * to have to remind it"; and a misheard name Q kept repeating).
 *
 *   `GET  /v1/q/memory` — the person's own live memory items.
 *   `POST /v1/q/memory/:memoryItemId/forget` — forget one. Idempotent: an
 *   item already forgotten, or not theirs, is the same 404.
 *   `POST /v1/me/memory/:memoryItemId/correct` (the API, a declared
 *   person action, ADR 0040) — replace one with the person's own words.
 *   It goes through the memory Write Gate like any remembered fact: the
 *   corrected item supersedes the old one, which stays in history marked
 *   superseded. Not theirs, or not live: 404.
 *
 * Only the actor's own memory: the owner is resolved from the session,
 * never from the request.
 */
export const Q_MEMORY_PATH = "/v1/q/memory" as const;
export const Q_MEMORY_FORGET_PATH =
  "/v1/q/memory/:memoryItemId/forget" as const;
export const MEMORY_CORRECT_PATH =
  "/v1/me/memory/:memoryItemId/correct" as const;

export const Q_MEMORY_KINDS = [
  "fact",
  "preference",
  "correction",
  "pronunciation",
  // ADR 0062: what the person mentioned in passing; kept 90 days.
  "small_talk",
] as const;

export const QMemoryItemDtoSchema = z
  .object({
    memoryItemId: UuidSchema,
    /** fact, preference, correction, pronunciation; reference data, so any code. */
    kind: z.string().min(1).max(40),
    /** In Q's words, as it recalls it. */
    content: z.string().min(1).max(2_000),
    /** The person's own words it was learned from, when kept. */
    quote: z.string().max(2_000).nullable(),
    about: z.enum(["YOU", "COMPANY"]),
    learnedAt: UtcTimestampSchema,
    /**
     * How Q came to know it, for the line under it: SAID (the person's own
     * words, quoted), CORRECTED (their correction), LEARNED (Q's reading
     * of how they work, from conversations). Absent from an older server.
     */
    origin: z.enum(["SAID", "CORRECTED", "LEARNED"]).optional(),
    /** When it lapses (small talk, ADR 0062); null when it is kept. */
    forgetsAt: UtcTimestampSchema.nullable().optional(),
  })
  .strict();
export type QMemoryItemDto = z.infer<typeof QMemoryItemDtoSchema>;

/** The person's own words for what Q should remember instead. */
export const QMemoryCorrectionRequestSchema = z
  .object({ content: z.string().trim().min(3).max(1_000) })
  .strict();
export type QMemoryCorrectionRequest = z.infer<
  typeof QMemoryCorrectionRequestSchema
>;

export const QMemoryCorrectionDtoSchema = z
  .object({ corrected: z.literal(true) })
  .strict();

export const QMemoryListDtoSchema = z
  .object({ items: z.array(QMemoryItemDtoSchema).max(200) })
  .strict();
export type QMemoryListDto = z.infer<typeof QMemoryListDtoSchema>;

/**
 * Consent to learn how the person likes to work (lane ob1; owner decision
 * 2026-10-16). `GET` reads the caller's own decision in their current
 * workspace; `POST` records one. What they state explicitly is kept
 * either way; this governs only what Q infers.
 */
export const Q_MEMORY_LEARNING_PATH = "/v1/q/memory/learning" as const;

export const QPreferenceLearningDtoSchema = z
  .object({
    status: z.enum(["NOT_ASKED", "GRANTED", "DECLINED", "REVOKED"]),
    /** Whether Q may put the question now. */
    mayAsk: z.boolean(),
    askAgainAfter: UtcTimestampSchema.nullable(),
  })
  .strict();
export type QPreferenceLearningDto = z.infer<
  typeof QPreferenceLearningDtoSchema
>;

export const QPreferenceLearningChoiceRequestSchema = z
  .object({
    choice: z.enum(["ALLOW", "NOT_NOW", "TURN_OFF"]),
    /** PROMPT: the one-line question; SETTINGS: the switch. */
    via: z.enum(["PROMPT", "SETTINGS"]),
  })
  .strict();
export type QPreferenceLearningChoiceRequest = z.infer<
  typeof QPreferenceLearningChoiceRequestSchema
>;
