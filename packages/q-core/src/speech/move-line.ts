/**
 * R3 (founder: "Q says it's opening; the app then shows an error that the
 * page could not be opened"; hosted 2026-10-09 run ae1144d7 said "Up now:
 * Tensorgate." before the page had rendered). What Q says about a page
 * move, by the browser lifecycle's phase -- one source for typed and voice.
 *
 * Q's answer is composed before the browser moves, so it only ever says
 * the PENDING line. "Opened" is said only once the browser's VERIFIED
 * receipt arrives (the web chat swaps the line; the live voice is told by
 * the receipt note), and FAILED says plainly that it did not open.
 */
export type MovePhase = "PENDING" | "VERIFIED" | "FAILED" | "ASKED";

const HOME = /^(?:home|home now)$/iu;

function capitalised(text: string): string {
  return text.length === 0
    ? text
    : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

/** The line for a move to `place` ("Capital", "your relationships", a record's name). */
export function movePhaseLine(phase: MovePhase, place: string): string {
  const where = place.trim();
  const home = HOME.test(where);
  switch (phase) {
    case "PENDING":
      return home ? "Heading home…" : `Opening ${where}…`;
    case "VERIFIED":
      // Never "<place> is open": places are often plural (INC-1).
      return home ? "You're home." : `Opened ${where}.`;
    case "FAILED":
      return home ? "Home didn't open." : `${capitalised(where)} didn't open.`;
    // A move this tab holds no receipt for (a reload, history): neutral
    // past wording, never a pending state that can't resolve.
    case "ASKED":
      return home ? "Asked to go home." : `Asked to open ${where}.`;
  }
}

/**
 * The place a PENDING line names, when `text` starts with one ("Opening
 * Capital…", "Heading home… Want me to…"); null for anything else.
 */
export function pendingPlaceOf(text: string): string | null {
  const trimmed = text.trim();
  if (/^Heading home…/u.test(trimmed)) return "home";
  const place = /^Opening\s+([^…\n]{1,80}?)…/u.exec(trimmed)?.[1];
  return place === undefined ? null : place.trim();
}
