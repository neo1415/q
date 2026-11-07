import { z } from "zod";

import {
  QNavigateTargetSchema,
  type QNavigateTarget,
} from "@capital-q/contracts";

/**
 * Q-NAV: the navigation eval of the Q Workspace (plan W4.4,
 * docs/specs/q-workspace/Q_WORKSPACE_PLAN.md; DECISIONS 71 amends N1: Q
 * may move the page pane on its own, model-led). On every turn Q decides
 * MOVE (the exact place), OFFER ("Open the thread?") or STAY.
 *
 * v2 (owner, 6 Nov 2026 ~22:50): the coverage is the whole site, generated
 * from the contracts' destinations and record pages (vocabulary.ts), for
 * both sides; phrasing varies heavily; curveballs are built to break it;
 * the held-out split (>= 30% of the turns) is written separately
 * (heldout.ts) and is never tuned against. Targets are W3.1's
 * QNavigateTarget, exactly (feat/q-deep-links f14c5f6a9), on a fictional
 * world with stable ids (world.ts).
 *
 * Stop criteria (owner): stop tuning when the held-out gates hold
 * (plan §6); a category still below its gate after three tuning rounds is
 * reported with its root cause, not looped on.
 */
export const Q_NAV_DATASET_VERSION = "q-nav-v2" as const;

export const Q_NAV_DECISIONS = ["MOVE", "OFFER", "STAY"] as const;
export type QNavDecision = (typeof Q_NAV_DECISIONS)[number];

export const Q_NAV_CATEGORIES = [
  /** Every destination, for each side that may open it (generated). */
  "COVERAGE",
  /** Every record page and tab, sections, documents, slides (generated). */
  "RECORD",
  /** A relationship's thread, at its latest message. */
  "THREAD",
  /** A list, comparison or analysis made for the question: no page. */
  "STAY_IN_CHAT",
  /** Sounds like navigation, is not ("what does a pipeline review involve?"). */
  "LOOKALIKE_STAY",
  /** Sounds like chat, is about a page ("I wonder how Brightwell's numbers look"). */
  "LOOKALIKE_MOVE",
  /** A page word that means something else ("the pipeline of ideas in my head"). */
  "FALSE_PAGE_WORD",
  /** Two asks in one turn. */
  "TWO_ASKS",
  "TYPO",
  "VOICE",
  "NON_ENGLISH",
  "SARCASM",
  /** Pronouns, ordinals, "and their deck?", follow-ups after Q moved. */
  "FOLLOW_UP",
  "GO_BACK",
  /** "Not that one, the other." */
  "NOT_THAT_ONE",
  /** They moved the page themselves since Q last moved it. */
  "STALE_CONTEXT",
  /** Records with similar names, or two in context: ask, never guess. */
  "AMBIGUITY",
  "DIRTY_FORM",
  /** Typing or scrolling in the page pane. */
  "BUSY_PANE",
  "COLLAPSED_PANE",
  /** A page this person cannot open. */
  "ACCESS",
  /** A page Capital Q does not have. */
  "NO_SUCH_PAGE",
  /** A record that was deleted. */
  "DELETED_RECORD",
  /** Page or document text that tries to steer navigation. */
  "ADVERSARIAL",
  /** Already there: no move. */
  "ALREADY_THERE",
] as const;
export type QNavCategory = (typeof Q_NAV_CATEGORIES)[number];

export const Q_NAV_SIDES = ["INVESTOR", "FOUNDER"] as const;
export type QNavSide = (typeof Q_NAV_SIDES)[number];

/** "dev" is tuned against; "heldout" is written separately, measured only. */
export const Q_NAV_SPLITS = ["dev", "heldout"] as const;
export type QNavSplit = (typeof Q_NAV_SPLITS)[number];

export { QNavigateTargetSchema as QNavTargetSchema };
export type QNavTarget = QNavigateTarget;

/** Where the person is and what the page pane is doing as they speak. */
export const QNavContextSchema = z
  .object({
    /** The page pane's current place. */
    at: QNavigateTargetSchema,
    /** Where it was before (for "go back"), when it moved. */
    previous: QNavigateTargetSchema.nullable(),
    pane: z.enum(["OPEN", "COLLAPSED"]),
    /** Unsaved work on the current page (a leave guard is registered). */
    dirty: z.boolean(),
    /** The person is typing or scrolling in the page pane right now. */
    busy: z.enum(["TYPING", "SCROLLING"]).nullable(),
    /** Text on the current page or document (planted text in curveballs). */
    pageText: z.string().max(600).nullable(),
  })
  .strict();
export type QNavContext = z.infer<typeof QNavContextSchema>;

export const QNavExpectSchema = z
  .object({
    decision: z.enum(Q_NAV_DECISIONS),
    /** MOVE and OFFER: the exact place. STAY: none. */
    target: QNavigateTargetSchema.nullable(),
    /** MOVE with the page pane collapsed: open it (they asked about a page). */
    openPane: z.boolean(),
    /** STAY with a collapsed pane: the move kept for when they open it. */
    remembered: QNavigateTargetSchema.nullable(),
    /** Pages no reply may move to or offer on this turn. */
    forbiddenPages: z.array(z.string()).max(80),
    /** The policy the turn tests, in one line. */
    why: z.string().min(8).max(300),
  })
  .strict()
  .refine((e) => (e.decision === "STAY") === (e.target === null), {
    message: "MOVE and OFFER name a target; STAY names none",
  })
  .refine((e) => !e.openPane || e.decision === "MOVE", {
    message: "only a MOVE opens the pane",
  })
  .refine((e) => e.remembered === null || e.decision === "STAY", {
    message: "a remembered move is a STAY now",
  });
export type QNavExpect = z.infer<typeof QNavExpectSchema>;

export const QNavTurnSchema = z
  .object({
    user: z.string().min(1).max(400),
    modality: z.enum(["TEXT", "VOICE"]),
    /** ISO 639-1 language of `user`. */
    language: z.string().regex(/^[a-z]{2}$/u),
    context: QNavContextSchema,
    expect: QNavExpectSchema,
    /** What Q said back (the conversation later turns read). */
    q: z.string().min(1).max(600),
  })
  .strict();
export type QNavTurn = z.infer<typeof QNavTurnSchema>;

export const QNavCaseSchema = z
  .object({
    id: z.string().regex(/^QNAV-[A-Z]{1,4}-[A-Z]{2,4}-\d{3}$/u),
    category: z.enum(Q_NAV_CATEGORIES),
    side: z.enum(Q_NAV_SIDES),
    split: z.enum(Q_NAV_SPLITS),
    turns: z.array(QNavTurnSchema).min(1).max(8),
  })
  .strict();
export type QNavCase = z.infer<typeof QNavCaseSchema>;

/** What a subject (Q, a scripted model, a baseline) decided on a turn. */
export type QNavReply = {
  readonly decision: QNavDecision;
  readonly target: QNavTarget | null;
  readonly openPane?: boolean | undefined;
  readonly remembered?: QNavTarget | null | undefined;
};
