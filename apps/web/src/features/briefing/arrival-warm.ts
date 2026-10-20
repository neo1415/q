import "server-only";

import { qApiSession } from "@/features/q/context";

import { createQApiArrivalSnapshotReader } from "./attention";

/**
 * Speed lane 2026-10-20: the Arrival Snapshot is asked for while Home
 * renders, not awaited, so the Q API builds it (cold: ~1.4 s, live
 * 2026-10-15) while the page is sent and hydrated. The browser's arrival
 * read, Q's first turn and the voice line then find it built, or join the
 * same build in flight (the Q API's cache shares one load per actor).
 *
 * The person's own session, the same read the browser's briefing makes;
 * nothing is returned or kept here.
 */
export function warmArrivalSnapshot(): void {
  void qApiSession()
    .then((session) =>
      session === null ? null : createQApiArrivalSnapshotReader(session)(),
    )
    .catch(() => null);
}
