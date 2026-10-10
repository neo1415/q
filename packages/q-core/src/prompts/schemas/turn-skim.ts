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

export const TurnSkimV1ResultSchema = z
  .object({
    kind: z.enum(TURN_SKIM_KINDS),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    /** How many companies they asked for; null when no number. */
    count: z.number().int().min(1).max(100).nullable().default(null),
    /** DISCOVER_COMPANIES only; null otherwise. */
    discover: DiscoverRequestSchema.nullable().default(null),
  })
  .strict();
export type TurnSkimV1Result = z.infer<typeof TurnSkimV1ResultSchema>;

/** v2 (W2, 2026-10-10): adds PERSON_SEARCH and the person it names. */
export const TURN_SKIM_V2_SCHEMA_VERSION = 2;
export const TURN_SKIM_V2_KINDS = [
  "DISCOVER_COMPANIES",
  "FIT",
  "PERSON_SEARCH",
  "OTHER",
] as const;

export const SkimPersonSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    kind: z
      .enum(["PERSON", "ORGANIZATION", "GOVERNMENT_AGENCY"])
      .default("PERSON"),
    city: z.string().trim().max(80).nullable().default(null),
    country: z.string().trim().max(80).nullable().default(null),
    organization: z.string().trim().max(120).nullable().default(null),
    role: z.string().trim().max(120).nullable().default(null),
    /** True only when they ask to search again, refresh or check what is new. */
    freshSearch: z.boolean().default(false),
  })
  .strict();
export type SkimPerson = z.infer<typeof SkimPersonSchema>;

export const TurnSkimV2ResultSchema = z
  .object({
    kind: z.enum(TURN_SKIM_V2_KINDS),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    count: z.number().int().min(1).max(100).nullable().default(null),
    discover: DiscoverRequestSchema.nullable().default(null),
    /** PERSON_SEARCH only; null otherwise. */
    person: SkimPersonSchema.nullable().default(null),
  })
  .strict();
export type TurnSkimV2Result = z.infer<typeof TurnSkimV2ResultSchema>;

/**
 * v3 (W1, 2026-10-10): adds ARRIVAL_FOLLOWUP, a question about one of the
 * items Q told them on arrival, in any words ("so what did TensorGate
 * want?", "any word back on the meeting?"). The skim is shown the arrival
 * items (key, counterpart, headline) and names the item and the aspect;
 * code then answers from the Arrival Snapshot with no tool.
 */
export const TURN_SKIM_V3_SCHEMA_VERSION = 3;
export const TURN_SKIM_V3_KINDS = [
  ...TURN_SKIM_V2_KINDS,
  "ARRIVAL_FOLLOWUP",
] as const;
export const ARRIVAL_ASPECTS = [
  "REQUEST",
  "THEIR_MESSAGE",
  "MEETING",
  "NEXT_STEP",
] as const;

export const TurnSkimV3VariablesSchema = TurnSkimVariablesSchema.extend({
  /** The arrival items as JSON [{key, counterpart, headline}]. UNTRUSTED. */
  arrivalItems: z.string().max(1_500),
}).strict();
export type TurnSkimV3Variables = z.infer<typeof TurnSkimV3VariablesSchema>;
export const TURN_SKIM_V3_UNTRUSTED = [
  "utterance",
  "recentTurns",
  "arrivalItems",
] as const;

export const TurnSkimV3ResultSchema = z
  .object({
    kind: z.enum(TURN_SKIM_V3_KINDS),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    count: z.number().int().min(1).max(100).nullable().default(null),
    discover: DiscoverRequestSchema.nullable().default(null),
    /** PERSON_SEARCH only; null otherwise. */
    person: SkimPersonSchema.nullable().default(null),
    /** ARRIVAL_FOLLOWUP only: the item's key as listed, and the aspect. */
    arrival: z
      .object({
        item: z.string().trim().min(1).max(160),
        aspect: z.enum(ARRIVAL_ASPECTS),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type TurnSkimV3Result = z.infer<typeof TurnSkimV3ResultSchema>;

/**
 * v4 (D1, 2026-10-10): adds DISCOVER_INVESTORS, a request for investors of
 * a region or kind without naming one ("top three Arab investors that may
 * be interested in this", "Gulf money", "who in Qatar might back us"), in
 * any words. The skim reads the meaning; code maps the region words to
 * countries and answers from the prepared index and a bounded search.
 */
export const TURN_SKIM_V4_SCHEMA_VERSION = 4;
export const TURN_SKIM_V4_KINDS = [
  ...TURN_SKIM_V3_KINDS,
  "DISCOVER_INVESTORS",
] as const;

export const SkimInvestorsSchema = z
  .object({
    /** Region, nationality or country words as they said them. */
    regions: z.array(z.string().trim().min(2).max(40)).max(4).default([]),
    /** A public sector word only; null unless they said one. */
    sector: z.string().trim().max(40).nullable().default(null),
    stage: z.string().trim().max(40).nullable().default(null),
    /** True when "this", "us" or "our" is their own company or raise. */
    aboutMyCompany: z.boolean().default(false),
  })
  .strict();
export type SkimInvestors = z.infer<typeof SkimInvestorsSchema>;

export const TurnSkimResultSchema = z
  .object({
    kind: z.enum(TURN_SKIM_V4_KINDS),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    count: z.number().int().min(1).max(100).nullable().default(null),
    discover: DiscoverRequestSchema.nullable().default(null),
    person: SkimPersonSchema.nullable().default(null),
    arrival: z
      .object({
        item: z.string().trim().min(1).max(160),
        aspect: z.enum(ARRIVAL_ASPECTS),
      })
      .strict()
      .nullable()
      .optional(),
    /** DISCOVER_INVESTORS only; null otherwise. */
    investors: SkimInvestorsSchema.nullable().optional(),
  })
  .strict();
export type TurnSkimResult = z.infer<typeof TurnSkimResultSchema>;
