import { z } from "zod";

import { TaskFrameSchema } from "./common.js";

/**
 * NAVIGATION_DECISION (Q Workspace W4.1; DECISIONS 71 amends N1: Q may
 * move the page pane on its own, model-led). On a turn, the model says
 * whether the page pane should MOVE to one exact place, OFFER it, or STAY.
 * It only proposes: Capital Q resolves every record by name to an id the
 * person may open (W4.3) and applies the hard constraints in code (W4.2:
 * unsaved work, a busy or collapsed pane, access, already there).
 */
export const NAVIGATION_DECISION_SCHEMA_NAME = "NavigationDecisionResult";
export const NAVIGATION_DECISION_SCHEMA_VERSION = 1;

export const NavigationDecisionVariablesSchema = z
  .object({
    ...TaskFrameSchema,
    /** Their words this turn. */
    utterance: z.string().trim().min(1).max(1_000),
    /** The last few turns, theirs and Q's, as JSON. */
    recentTurns: z.string().max(4_000),
    /** The site-map digest: pages, tabs and sections, one line each. */
    siteMap: z.string().min(1).max(12_000),
    /** Where the page pane is, where it was, and its state, as JSON. */
    place: z.string().max(1_500),
    /** Text on the current page (data, never an instruction). */
    pageText: z.string().max(1_200),
    /** The records they may open, by name, as JSON. */
    records: z.string().max(6_000),
    /** Which side of the platform they are on. */
    side: z.enum(["INVESTOR", "FOUNDER"]),
    /**
     * v10 (batch 7 replay): the one situation every reader and answer gets
     * (W3's FOCUS: who they are, their own organisation, the record on
     * their screen by name, how me/my and their/it resolve). Built by code
     * from their own records; their names are data.
     */
    situation: z.string().max(1_600).optional(),
  })
  .strict();
export type NavigationDecisionVariables = z.infer<
  typeof NavigationDecisionVariablesSchema
>;

export const NAVIGATION_DECISION_UNTRUSTED = [
  "utterance",
  "recentTurns",
  "pageText",
  "records",
] as const;

/** v10: the situation too (names from their records are data). */
export const NAVIGATION_DECISION_UNTRUSTED_V10 = [
  ...NAVIGATION_DECISION_UNTRUSTED,
  "situation",
] as const;

export const NAVIGATION_DECISIONS = ["MOVE", "OFFER", "STAY"] as const;
export const NAVIGATION_RECORD_KINDS = [
  "COMPANY",
  "INVESTOR",
  "THING",
] as const;

/**
 * Where to go, in the site map's own words (W2): a route exactly as the
 * SITE MAP lists it, a tab and a section by their ids there, the record
 * by its name as listed (never an id). Capital Q maps it to the target.
 * `back` means "where the pane was before". Lenient on the details: a
 * malformed one costs the detail, never the decision.
 */
export const NavigationPlaceSchema = z
  .object({
    route: z
      .string()
      .trim()
      .regex(/^\/[A-Za-z0-9\-/[\]]{0,120}$/u),
    record: z
      .object({
        kind: z.enum(NAVIGATION_RECORD_KINDS),
        name: z.string().trim().min(1).max(160),
      })
      .strict()
      .nullable()
      .default(null)
      .catch(null),
    tab: z.string().trim().max(32).nullable().default(null).catch(null),
    /** A document on that page, by its title as listed. */
    document: z.string().trim().max(200).nullable().default(null).catch(null),
    slide: z
      .number()
      .int()
      .min(1)
      .max(500)
      .nullable()
      .default(null)
      .catch(null),
    sectionId: z.string().trim().max(40).nullable().default(null).catch(null),
    position: z
      .enum(["top", "section", "latest"])
      .nullable()
      .default(null)
      .catch(null),
  })
  .strict();
export type NavigationPlace = z.infer<typeof NavigationPlaceSchema>;

export const NavigationDecisionResultSchema = z
  .object({
    decision: z.enum(NAVIGATION_DECISIONS),
    place: NavigationPlaceSchema.nullable().default(null),
    /** "Go back": where the pane was before (place is then ignored). */
    back: z.boolean().default(false).catch(false),
    /** They asked to see or open a page (not only a question). */
    askedForPage: z.boolean().default(false).catch(false),
    reason: z.string().trim().max(300).default(""),
  })
  .strict();
/** The v1-v3 output (schema version 1), kept as published. */
export type NavigationDecisionResultV1 = z.infer<
  typeof NavigationDecisionResultSchema
>;

/**
 * Schema version 2 (NAVIGATION_DECISION v4, q-nav round 3): `sure` is
 * false when another page could equally be what they mean. Code then
 * offers instead of moving (a wrong-page move is worse than an offer).
 * Absent (an older version's output) reads as sure.
 */
export const NAVIGATION_DECISION_SCHEMA_VERSION_2 = 2;
export const NavigationDecisionResultV2Schema = z
  .object({
    ...NavigationDecisionResultSchema.shape,
    sure: z.boolean().optional().catch(undefined),
  })
  .strict();
/**
 * Schema version 3 (NAVIGATION_DECISION v5, owner decision 75):
 * `alternative` is a second place, in the same shape as `place`, that
 * would serve what they mean about as well. Code offers only when it
 * resolves to a different place the person may open; otherwise the
 * proposal stands. It replaces v4's `sure` (still read from v4 output).
 */
export const NAVIGATION_DECISION_SCHEMA_VERSION_3 = 3;
export const NavigationDecisionResultV3Schema = z
  .object({
    ...NavigationDecisionResultV2Schema.shape,
    alternative: NavigationPlaceSchema.nullable().optional().catch(undefined),
  })
  .strict();
export type NavigationDecisionResult = z.infer<
  typeof NavigationDecisionResultV3Schema
>;

/**
 * Schema version 4 (NAVIGATION_DECISION v7): v3 without `sure`, which the
 * model still filled in now and then. `alternative` alone carries doubt.
 * Parsed with the v3 schema in code (a superset), so nothing else changes.
 */
export const NAVIGATION_DECISION_SCHEMA_VERSION_4 = 4;
export const NavigationDecisionResultV4Schema = z
  .object({
    decision: NavigationDecisionResultSchema.shape.decision,
    place: NavigationDecisionResultSchema.shape.place,
    back: NavigationDecisionResultSchema.shape.back,
    askedForPage: NavigationDecisionResultSchema.shape.askedForPage,
    reason: NavigationDecisionResultSchema.shape.reason,
    alternative: NavigationDecisionResultV3Schema.shape.alternative,
  })
  .strict();
