import { PICTOGRAM_KINDS } from "./figure-library";
import type { FigureKind } from "./presence-kit";

/**
 * Q Story S4: "form this now" -- the cue that lays a figure over Q's
 * presence while Q says what it is ("It's 11:47 at night": the clock).
 * The story engine calls it from its word clock; everyday Q calls it from
 * the run's own signals (presence-signals.ts). Both are code, never a
 * model's guess.
 *
 *   presence.form("CLOCK", { holdMs: 2400 }); // flow in, hold
 *   presence.release();                       // back to the state's figure
 *
 * One browser event every Q presence on the page listens to, like Q said
 * (q-said.ts); a presence too small to draw a pictogram legibly ignores
 * it. The state mapping (presence-machine.ts, P11) is untouched: the cue
 * lays its figure over the state's, and the state's flows back after.
 */
export const Q_FIGURE_EVENT = "cq:q-figure";

export const PRESENCE_FIGURE_IDS = [
  ...PICTOGRAM_KINDS,
  "LETTER_Q",
] as const satisfies readonly FigureKind[];

export type PresenceFigureId = (typeof PRESENCE_FIGURE_IDS)[number];

const IDS: ReadonlySet<string> = new Set(PRESENCE_FIGURE_IDS);

export function isPresenceFigureId(value: unknown): value is PresenceFigureId {
  return typeof value === "string" && IDS.has(value);
}

/** Below this a pictogram's strokes run together: the dock ignores cues. */
export const FIGURE_MIN_PIXELS = 96;

/** How long a figure holds, from the call, when the caller does not say. */
export const CUE_HOLD_DEFAULT_MS = 2400;
/** Shorter and the figure has not finished forming before it goes. */
export const CUE_HOLD_MIN_MS = 600;
/** Longer and Q is no longer talking about it. */
export const CUE_HOLD_MAX_MS = 15_000;

export type PresenceCue =
  | {
      readonly kind: "FORM";
      readonly figure: PresenceFigureId;
      readonly holdMs: number;
    }
  | { readonly kind: "RELEASE" };

export function clampHold(holdMs: number | undefined): number {
  if (holdMs === undefined || !Number.isFinite(holdMs)) {
    return CUE_HOLD_DEFAULT_MS;
  }
  return Math.max(CUE_HOLD_MIN_MS, Math.min(CUE_HOLD_MAX_MS, holdMs));
}

function announce(cue: PresenceCue): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PresenceCue>(Q_FIGURE_EVENT, { detail: cue }),
  );
}

export const presence = {
  /** Form `figure` over Q's presence and hold it `holdMs` from now. */
  form(figure: PresenceFigureId, options?: { readonly holdMs?: number }) {
    if (!isPresenceFigureId(figure)) return;
    announce({ kind: "FORM", figure, holdMs: clampHold(options?.holdMs) });
  },
  /** Let the figure go now: the state's own figure flows back. */
  release() {
    announce({ kind: "RELEASE" });
  },
} as const;

/** The cue an event carries, validated, or null for anything else. */
export function cueDetail(event: Event): PresenceCue | null {
  if (!(event instanceof CustomEvent)) return null;
  const detail: unknown = event.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const record = detail as Record<string, unknown>;
  if (record["kind"] === "RELEASE") return { kind: "RELEASE" };
  if (record["kind"] !== "FORM" || !isPresenceFigureId(record["figure"])) {
    return null;
  }
  const hold = record["holdMs"];
  return {
    kind: "FORM",
    figure: record["figure"],
    holdMs: clampHold(typeof hold === "number" ? hold : undefined),
  };
}
