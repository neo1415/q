import type { PresenceFigureId } from "./presence-cue";

/**
 * Q Story S4, everyday Q: which figure the run's own signals ask the
 * presence to form for a moment -- unscripted, and never a guess. Each
 * input is something code already decided: the approved stage Q is at,
 * the durable task it is on, the kind of object the answer carries, the
 * dotted type of an action it proposes, a UI intent, the live preview's
 * layout. No model, no words read: an answer about a house that carries
 * no MAP block forms nothing.
 *
 * Unknown stays unknown: a signal with no clear figure gives null, and
 * the presence keeps its state's own shape. Web research forms nothing
 * (R38, no search theatre), and nothing here suggests a verdict: a chart
 * is bars, never a rise or a fall; a comparison is two columns.
 */

/** How long an everyday figure holds: a glance, not a slide. */
export const EVERYDAY_HOLD_MS = 1200;

/** The run's signals, as plain values (structural, so any caller fits). */
export type PresenceSignals = {
  /** The approved stage Q is at now, while it works. */
  readonly stage?: string | null | undefined;
  /** A durable task's kind (QStageAbout.task.kind). */
  readonly task?: string | null | undefined;
  /** The kinds of object the answer carries, in order. */
  readonly blocks?: readonly PresenceSignalBlock[] | undefined;
  /** The live preview's layout and how many subjects it names. */
  readonly preview?:
    | { readonly layout: string | null; readonly subjects: number }
    | null
    | undefined;
};

export type PresenceSignalBlock = {
  readonly kind: string;
  /** ACTION_PROPOSAL: the proposal's dotted action type. */
  readonly actionType?: string | undefined;
  /** UI_INTENT: the intent's kind. */
  readonly intentKind?: string | undefined;
};

const STAGE_FIGURES: Readonly<Record<string, PresenceFigureId>> = {
  COMPARING_OPPORTUNITIES: "COMPARE",
  CHECKING_EVIDENCE: "DOCUMENT",
  REVIEWING_RELATIONSHIP: "HANDSHAKE",
  PREPARING_DOCUMENT: "DOCUMENT",
  DESIGNING_DOCUMENT: "DOCUMENT",
  CHECKING_DOCUMENT: "DOCUMENT",
  REVISING_DOCUMENT: "PEN",
};

const BLOCK_FIGURES: Readonly<Record<string, PresenceFigureId>> = {
  COMPARISON: "COMPARE",
  COMPARISON_CARDS: "COMPARE",
  TABLE: "COMPARE",
  CHART: "CHART_BARS",
  MAP: "MAP_PIN",
  TIMELINE: "CALENDAR",
  ARTIFACT_REFERENCE: "DOCUMENT",
};

const INTENT_FIGURES: Readonly<Record<string, PresenceFigureId>> = {
  SHOW_CALENDAR_CONNECT: "CALENDAR",
  OPEN_BOOK_CALL: "CALENDAR",
  SHOW_COMPARISON: "COMPARE",
};

/** An action's figure by its domain, the first part of its dotted type. */
const ACTION_FIGURES: Readonly<Record<string, PresenceFigureId>> = {
  meeting: "CALENDAR",
  schedule: "CALENDAR",
  calendar: "CALENDAR",
  message: "ENVELOPE",
  email: "ENVELOPE",
  document: "DOCUMENT",
};

const DOCUMENT_TASKS: ReadonlySet<string> = new Set([
  "INVESTMENT_BRIEF",
  "PITCH_DECK",
  "ONE_PAGER",
  "MEMO",
]);

function blockFigure(block: PresenceSignalBlock): PresenceFigureId | null {
  if (block.kind === "ACTION_PROPOSAL") {
    const domain = block.actionType?.split(".")[0];
    return domain === undefined ? null : (ACTION_FIGURES[domain] ?? null);
  }
  if (block.kind === "UI_INTENT") {
    return block.intentKind === undefined
      ? null
      : (INTENT_FIGURES[block.intentKind] ?? null);
  }
  return BLOCK_FIGURES[block.kind] ?? null;
}

/**
 * The figure the signals ask for, or null. What the answer carries wins
 * (it is what is about to be on screen), then what Q is doing now (a
 * proposal, then the stage and its task), then the preview's layout.
 */
export function figureForSignals(
  signals: PresenceSignals,
): PresenceFigureId | null {
  // The last object is the one the answer ends on, and stays on screen.
  for (const block of (signals.blocks ?? []).toReversed()) {
    const figure = blockFigure(block);
    if (figure !== null) return figure;
  }
  const stage =
    signals.stage === null || signals.stage === undefined
      ? undefined
      : STAGE_FIGURES[signals.stage];
  if (stage !== undefined) return stage;
  if (
    signals.task !== null &&
    signals.task !== undefined &&
    DOCUMENT_TASKS.has(signals.task)
  ) {
    return "DOCUMENT";
  }
  const preview = signals.preview;
  if (preview !== null && preview !== undefined) {
    if (preview.layout === "TABLE" && preview.subjects >= 2) return "COMPARE";
    if (preview.layout === "SUMMARY") return "DOCUMENT";
  }
  return null;
}
