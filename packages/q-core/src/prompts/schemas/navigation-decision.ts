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

export const NAVIGATION_DECISIONS = ["MOVE", "OFFER", "STAY"] as const;
export const NAVIGATION_RECORD_KINDS = [
  "COMPANY",
  "INVESTOR",
  "THING",
] as const;

/**
 * Where to go, as the model names it: a page of the site map, the record
 * by its name as listed (never an id), and the page's details. `back`
 * means "where the pane was before". Lenient on the details: a malformed
 * one costs the detail, never the decision.
 */
export const NavigationPlaceSchema = z
  .object({
    page: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,47}$/u),
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
export type NavigationDecisionResult = z.infer<
  typeof NavigationDecisionResultSchema
>;
