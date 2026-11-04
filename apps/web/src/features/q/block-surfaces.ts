import {
  Q_BLOCK_SURFACES,
  type QBlockStagePlace,
  type QBlockThreadPlace,
} from "@capital-q/contracts";

import type { QTurnObjectBlock } from "./conversation";

/**
 * N3 (owner 2026-11-04): the one rule for where each kind of block is drawn
 * in the web's views, derived from the shared table (contracts'
 * Q_BLOCK_SURFACES, which the gateway's "on your screen" guard reads too).
 *
 * - "thread": Chat and the dock. Every block the answer carries is drawn,
 *   by its thread place: in view, behind a chip, or on the one approval
 *   control.
 * - "caption": the Q view's captions under the stage. The stage draws its
 *   OBJECT and BESIDE kinds; the caption draws the rest, so the Q view
 *   draws each block once (never the stage's table again beneath it, never
 *   neither).
 *
 * Whatever the view, a person's own choices still apply the same way: a
 * card they closed is closed everywhere (cards/card-visibility), and what
 * the stage put away stays one tap away under "Shown recently".
 */
export type QBlockSurface = "thread" | "caption";

export function threadPlaceOf(
  kind: QTurnObjectBlock["kind"],
): QBlockThreadPlace {
  return Q_BLOCK_SURFACES[kind].thread;
}

export function stagePlaceOf(kind: QTurnObjectBlock["kind"]): QBlockStagePlace {
  return Q_BLOCK_SURFACES[kind].stage;
}

/** The kinds the stage draws as its object (shown.ts). */
export function onStage(kind: QTurnObjectBlock["kind"]): boolean {
  return stagePlaceOf(kind) === "OBJECT";
}

/** The kinds the stage draws beside its object (an offer to open a page). */
export function besideStage(kind: QTurnObjectBlock["kind"]): boolean {
  return stagePlaceOf(kind) === "BESIDE";
}

/** Where a block is drawn on this surface; null when the stage draws it. */
export function placeOn(
  surface: QBlockSurface,
  kind: QTurnObjectBlock["kind"],
): QBlockThreadPlace | null {
  if (surface === "caption" && stagePlaceOf(kind) !== "CAPTION") return null;
  return threadPlaceOf(kind);
}
