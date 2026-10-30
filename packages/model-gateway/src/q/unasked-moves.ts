import type { QResultBlock } from "@capital-q/contracts";
import { asksForDrawing, asksForMove } from "@capital-q/q-core";

/** What Q draws in place: the answer IS the object, shown where they are. */
const DRAWN: ReadonlySet<QResultBlock["kind"]> = new Set([
  "MAP",
  "CHART",
  "TABLE",
  "TIMELINE",
]);

/** Intents that take the person off the page they are on. */
const MOVES: ReadonlySet<string> = new Set([
  "NAVIGATE",
  "OPEN_COMPANY",
  "OPEN_RECORD_PAGE",
  "OPEN_SETTINGS",
  "OPEN_SETUP",
]);

/**
 * Owner 2026-10-15 ("I asked for a map, it showed the map ... but
 * immediately switched to the profile of that company"): an answer that
 * draws something, or answers a request to see something drawn, never
 * also moves the person away unless their own words asked to go. Hosted,
 * the model drew a MAP and called open_page in the same turn; the screen
 * followed the move and the map was gone the moment it landed.
 *
 * Code, from the person's words: the move is dropped, the drawing stays.
 * A move they asked for ("open Tensorgate and show me a chart") is kept.
 */
export function withoutUnaskedMoves(
  blocks: readonly QResultBlock[],
  asked: string,
): QResultBlock[] {
  const draws =
    blocks.some((block) => DRAWN.has(block.kind)) || asksForDrawing(asked);
  if (!draws || asksForMove(asked)) return [...blocks];
  return blocks.filter(
    (block) => block.kind !== "UI_INTENT" || !MOVES.has(block.intent.kind),
  );
}

/**
 * Live 2026-10-30: whether a tool's authorised result would move the
 * person's screen (its clientAction is a move). Used to refuse a move on a
 * turn that took Q up on an offer code did not record, where any
 * destination would be a guess at what was offered.
 */
export function carriesScreenMove(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const action = (data as { readonly clientAction?: unknown }).clientAction;
  if (typeof action !== "object" || action === null) return false;
  const kind = (action as { readonly kind?: unknown }).kind;
  return typeof kind === "string" && MOVES.has(kind);
}
