import type { Briefing } from "./briefing";

/**
 * Whether this page shows (and, with voice on, says) Q's briefing (R35).
 *
 * A briefing is for arriving, not for every visit to Home: it is given
 * when it holds something not already briefed today, and then all of it
 * is given. What was briefed is a per-viewer convenience kept in this
 * browser only; storage that is blocked or empty simply means the
 * briefing is given again, never that it is lost.
 *
 * Decided once per page load and shared, so the cards on screen and the
 * words Q speaks never disagree about whether there was a briefing.
 */

const KEY = "cq.q.briefed";

type Briefed = { readonly day: string; readonly ids: readonly string[] };

const decided = new Map<string, boolean>();

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function readBriefed(): Briefed | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "day" in value &&
      "ids" in value &&
      typeof value.day === "string" &&
      Array.isArray(value.ids)
    ) {
      return {
        day: value.day,
        ids: value.ids.filter((id): id is string => typeof id === "string"),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeBriefed(briefed: Briefed): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(briefed));
  } catch {
    // Blocked storage: the briefing is simply given again next time.
  }
}

/** The briefing to give on this page, or null. */
export function decideBriefing(
  briefing: Briefing | null | undefined,
  now: Date = new Date(),
): Briefing | null {
  // A briefing streamed from the server can arrive as undefined; that is
  // "no briefing", never an error that stops Q from talking.
  if (briefing == null || !Array.isArray(briefing.items)) return null;
  if (briefing.items.length === 0) return null;
  const key = briefing.items.map((item) => item.id).join("|");
  const known = decided.get(key);
  if (known !== undefined) return known ? briefing : null;
  const day = today(now);
  const before = readBriefed();
  const seen = new Set(before?.day === day ? before.ids : []);
  const give = briefing.items.some((item) => !seen.has(item.id));
  decided.set(key, give);
  if (give) {
    writeBriefed({
      day,
      ids: [...seen, ...briefing.items.map((item) => item.id)].slice(-50),
    });
  }
  return give ? briefing : null;
}

/** For tests: forget this page load's decisions. */
export function resetBriefingDecisions(): void {
  decided.clear();
}
