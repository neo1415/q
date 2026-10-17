/**
 * v6: where `/q-pitch?start=1` (Q's Q_PITCH destination, reached from
 * "pitch Capital Q" by meaning) starts the tour, by the person's side. The
 * host still admits only accounts it may run on; this only picks the track.
 *
 * `new=1`: Home opens a new conversation, so the tour's first step shows
 * Home itself. Live 2026-10-17: reached from Q's answer, a bare /home kept
 * the tab's conversation (the ask that started the tour), and the founder's
 * Home sections the first step lights were not on screen.
 */
export function tourStartFor(kind: string): string | null {
  if (kind === "INVESTOR") return "/home?qpitch=investor-v6&new=1";
  if (kind === "FOUNDER") return "/home?qpitch=founder-v6&new=1";
  return null;
}
