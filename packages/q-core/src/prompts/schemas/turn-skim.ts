import { z } from "zod";

import { DiscoverRequestSchema } from "../../conversation/reading.js";
import { TaskFrameSchema } from "./common.js";

/**
 * TURN_SKIM -- a short first read of a turn, beside the full turn reader
 * (founder brief K, 2026-10-09). The turn read was the floor of every
 * answer (p50 1.2 s on the fast-classification model, ~6.6k input and ~180
 * output tokens); a read-only app query -- companies of a kind, computed
 * fit -- needs only a few fields of it. This prompt is small and asks for
 * only those, so the fast lane can answer before the full reading lands.
 * It never decides anything with a side effect: only a read-only path
 * acts on it, and only on a HIGH confidence reading.
 */

export const TURN_SKIM_SCHEMA_NAME = "TurnSkimResult";
export const TURN_SKIM_SCHEMA_VERSION = 1;

export const TurnSkimVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** What the person just said. UNTRUSTED. */
    utterance: z.string().trim().min(1).max(1_000),
    /** The last two turns, as JSON. UNTRUSTED. */
    recentTurns: z.string().max(1_500),
  })
  .strict();
export type TurnSkimVariables = z.infer<typeof TurnSkimVariablesSchema>;

export const TURN_SKIM_UNTRUSTED = ["utterance", "recentTurns"] as const;

export const TURN_SKIM_KINDS = ["DISCOVER_COMPANIES", "FIT", "OTHER"] as const;

export const TurnSkimResultSchema = z
  .object({
    kind: z.enum(TURN_SKIM_KINDS),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    /** How many companies they asked for; null when no number. */
    count: z.number().int().min(1).max(100).nullable().default(null),
    /** DISCOVER_COMPANIES only; null otherwise. */
    discover: DiscoverRequestSchema.nullable().default(null),
  })
  .strict();
export type TurnSkimResult = z.infer<typeof TurnSkimResultSchema>;
