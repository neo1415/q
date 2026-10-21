import type { ArrivalData } from "./arrival";
import type { ArrivalBrowserInput } from "./arrival-briefing-server";
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

/** The route the browser's arrival read is asked of. */
export const ARRIVAL_READ_PATH = "/api/q-arrival";

/**
 * What the route answered, as the briefing's data; null when it is not
 * (no session, a failed read, anything unexpected). The route is this
 * app's own server, so this checks the shape the briefing relies on
 * rather than every field.
 */
export function arrivalDataOf(value: unknown): ArrivalData | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("cards" in value) || !Array.isArray(value.cards)) return null;
  if (!("firstName" in value) || !("hoursAway" in value)) return null;
  // Our own server's answer, checked for the fields the briefing reads first.
  return value as ArrivalData;
}

/**
 * The arrival read, with this browser's part of the input. A route, not a
 * server action (speed lane 2026-10-20): actions run one at a time per
 * tab, and this read waited behind Home's other ones.
 */
export async function loadArrival(
  since: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrivalData | null> {
  try {
    const response = await fetchImpl(ARRIVAL_READ_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ since, browser: browserArrivalInput() }),
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    return arrivalDataOf(await response.json());
  } catch {
    return null;
  }
}
