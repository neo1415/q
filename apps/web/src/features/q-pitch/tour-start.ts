/**
 * v6: where `/q-pitch?start=1` (Q's Q_PITCH destination, reached from
 * "pitch Capital Q" by meaning) starts the tour, by the person's side. The
 * host still admits only accounts it may run on; this only picks the track.
 */
export function tourStartFor(kind: string): string | null {
  if (kind === "INVESTOR") return "/home?qpitch=premiere";
  if (kind === "FOUNDER") return "/home?qpitch=founder-v6";
  return null;
}
