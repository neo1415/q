"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  QClientActionIntentSchema,
  type QClientActionIntent,
  type QResultBlock,
  type QVoiceDestination,
} from "@capital-q/contracts";
import { movePhaseLine, pendingPlaceOf } from "@capital-q/q-core/speech";

import { movePath } from "../voice/live/move";
import {
  lastNavigationTo,
  navigationFailureMessage,
  onNavigationPhase,
  routesMatch,
  type NavigationState,
} from "./control/navigation-lifecycle";

/**
 * R3: Q's typed answer says a move is pending ("Opening Capital…") because
 * it is composed before the browser moves. Once this tab's navigation
 * lifecycle has VERIFIED that route, the row says it opened; FAILED says
 * it didn't, with the lifecycle's reason. Same words as the voice
 * (`movePhaseLine`, one source). A turn whose move this tab never made (a
 * reload, history) keeps its pending words: nothing is claimed unverified.
 */

/** The route a turn's blocks move the screen to, if any. */
export function routeOfBlocks(blocks: readonly QResultBlock[]): string | null {
  let navigate: QVoiceDestination | null = null;
  let action: QClientActionIntent | null = null;
  for (const block of blocks) {
    if (block.kind !== "UI_INTENT") continue;
    if (block.intent.kind === "NAVIGATE") {
      navigate = block.intent.destination;
      continue;
    }
    const parsed = QClientActionIntentSchema.safeParse(block.intent);
    if (parsed.success) action = parsed.data;
  }
  if (navigate === null && action === null) return null;
  return movePath({ navigate, action });
}

/**
 * The words for a turn's text given its move's lifecycle state in this
 * tab. No state (a reload, history): "Opened X." when the tab is on the
 * target now (`here`), else neutral past wording -- never left pending.
 */
export function moveLineOf(
  text: string,
  state: NavigationState | null,
  here = false,
): string {
  const place = pendingPlaceOf(text);
  if (place === null) return text;
  const lead = /^(?:Opening\s+[^…\n]{1,80}?|Heading home)…/u.exec(text.trim());
  const rest = lead === null ? "" : text.trim().slice(lead[0].length).trim();
  const phase = state === null ? (here ? "VERIFIED" : "ASKED") : state.phase;
  if (phase === "VERIFIED" || phase === "ASKED") {
    return [movePhaseLine(phase, place), rest].filter(Boolean).join(" ");
  }
  if (phase === "FAILED") {
    const why =
      state?.reason === undefined ? "" : navigationFailureMessage(state.reason);
    return [movePhaseLine("FAILED", place), why].filter(Boolean).join(" ");
  }
  return text;
}

/** The turn's text, kept in step with its move's lifecycle in this tab. */
export function useMoveLine(
  text: string,
  blocks: readonly QResultBlock[],
): string {
  const route = routeOfBlocks(blocks);
  const subscribe = useCallback(
    (changed: () => void) => onNavigationPhase(() => changed()),
    [],
  );
  // A string snapshot: stable by value between changes.
  return useSyncExternalStore(
    subscribe,
    () => {
      if (route === null) return text;
      const here = routesMatch(
        route,
        `${window.location.pathname}${window.location.search}`,
      );
      return moveLineOf(text, lastNavigationTo(route), here);
    },
    () => text,
  );
}
