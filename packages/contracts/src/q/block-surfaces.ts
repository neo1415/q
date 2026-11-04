import { Q_RESULT_BLOCK_KINDS, type QResultBlockKind } from "./result-block.js";

/**
 * N3 (owner 2026-11-04): one conversation, one rule for where each kind of
 * result block is drawn, whichever view the person is in -- Chat, the Q
 * page's presence view (stage and captions), the dock, the voice room.
 * Switching views never makes a card, plan, document, chart, offer or job
 * disappear, and the Q view never draws the same block twice.
 *
 * Before N3 the rule lived in three unshared lists (the web's thread
 * filter, the stage's "showable" set and the gateway's "drawn" set) and
 * they had drifted: a plan, a schedule or a "needs you" report was absent
 * from the stage, and a table was drawn on the stage and again in the
 * caption beneath it. The web and the gateway now both derive from this
 * table, and its tests assert every kind of the union against it.
 *
 * Presentation metadata only: it decides where a block a person may already
 * see is drawn. It authorises nothing and carries no data.
 */

/**
 * Where a block is drawn in a thread of the conversation (Chat, the dock,
 * the Q view's captions for what the stage leaves to them).
 *
 * - OBJECT: in view, as its own card.
 * - CHIP: behind a small chip under the answer (Sources, Companies), one
 *   tap away; rendered hidden, never dropped.
 * - APPROVAL: on the one approval control (QNow) that every view mounts;
 *   a second Approve beside it would be a second place to say yes.
 * - PROSE: projected into the answer's words or its Sources count.
 */
export type QBlockThreadPlace = "OBJECT" | "CHIP" | "APPROVAL" | "PROSE";

/**
 * What the Q view's stage does with a block.
 *
 * - OBJECT: the stage draws it as (part of) the object over Q's presence;
 *   the caption beneath leaves it out, so it is drawn once.
 * - BESIDE: the stage draws it beside whatever object is up (an offer to
 *   open a page, which is not itself something to look at); the caption
 *   leaves it out.
 * - CAPTION: the stage leaves it to the caption, which draws it by its
 *   thread place.
 */
export type QBlockStagePlace = "OBJECT" | "BESIDE" | "CAPTION";

export type QBlockSurfaces = {
  readonly thread: QBlockThreadPlace;
  readonly stage: QBlockStagePlace;
  /**
   * The block is drawn on the person's screen as the answer arrives, in
   * every view, so a sentence saying something is on their screen is
   * backed by it (QA F-111, screen-claims.ts). An offer to open a page is
   * not: nothing has opened.
   */
  readonly drawn: boolean;
};

/** Every kind of the closed union, exhaustively (a new kind fails to compile). */
export const Q_BLOCK_SURFACES: Readonly<
  Record<QResultBlockKind, QBlockSurfaces>
> = {
  TEXT: { thread: "PROSE", stage: "CAPTION", drawn: false },
  COMPANY_REFERENCE: { thread: "CHIP", stage: "CAPTION", drawn: false },
  INVESTOR_REFERENCE: { thread: "CHIP", stage: "CAPTION", drawn: false },
  COMPARISON: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  COMPARISON_CARDS: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  ANSWER_CARDS: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  EVIDENCE: { thread: "PROSE", stage: "CAPTION", drawn: false },
  FINDING: { thread: "PROSE", stage: "CAPTION", drawn: false },
  UNCERTAINTY: { thread: "PROSE", stage: "CAPTION", drawn: false },
  // A question back is drawn, but it is not something "on screen" to point at.
  CLARIFICATION_REQUEST: { thread: "OBJECT", stage: "OBJECT", drawn: false },
  ACTION_PROPOSAL: { thread: "APPROVAL", stage: "CAPTION", drawn: false },
  ARTIFACT_REFERENCE: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  // A move the screen makes (or its link): the room and the caption handle it.
  UI_INTENT: { thread: "OBJECT", stage: "CAPTION", drawn: true },
  PUBLIC_SOURCE: { thread: "PROSE", stage: "CAPTION", drawn: false },
  TABLE: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  CHART: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  MAP: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  TIMELINE: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  ATTENTION: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  SUMMARY: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  PICTURE: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  WORK_IN_PROGRESS: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  SCHEDULE: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  PLAN: { thread: "OBJECT", stage: "OBJECT", drawn: true },
  NAVIGATION_OFFER: { thread: "OBJECT", stage: "BESIDE", drawn: false },
};

/** The kinds whose presence backs "it's on your screen" (screen-claims). */
export const Q_DRAWN_BLOCK_KINDS: ReadonlySet<QResultBlockKind> = new Set(
  Q_RESULT_BLOCK_KINDS.filter((kind) => Q_BLOCK_SURFACES[kind].drawn),
);

/** The kinds the Q view's stage draws as its object. */
export const Q_STAGE_OBJECT_KINDS: ReadonlySet<QResultBlockKind> = new Set(
  Q_RESULT_BLOCK_KINDS.filter(
    (kind) => Q_BLOCK_SURFACES[kind].stage === "OBJECT",
  ),
);
