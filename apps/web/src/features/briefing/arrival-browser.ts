import type { ArrivalData } from "./arrival";
import {
  arrivalBriefingAction,
  type ArrivalBrowserInput,
} from "./arrival-actions";
import { readSeenMatches } from "./matches";

/**
 * What only this browser knows, handed to the arrival read: the held
 * drafts the person dropped on Work (audit D-E6: the briefing brought them
 * back) and the companies earlier arrivals showed here. Both are
 * per-browser conveniences; a blocked storage reads as "none".
 */

const HELD_KEY = "cq.work.dismissedHeld";

function dismissedHeld(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(HELD_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed
          .filter((id): id is string => typeof id === "string")
          .slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

export function browserArrivalInput(): ArrivalBrowserInput {
  const seen = readSeenMatches();
  return {
    dismissedHeld: dismissedHeld(),
    seenMatches: seen === null ? null : [...seen].slice(0, 200),
  };
}

/** The arrival read, with this browser's part of the input. */
export function loadArrival(since: string | null): Promise<ArrivalData | null> {
  return arrivalBriefingAction(since, browserArrivalInput());
}
