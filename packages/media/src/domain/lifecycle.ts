import type { MediaStatus } from "../contracts/index.js";

/**
 * The media lifecycle, as a closed set of legal moves (doc 20 §14).
 *
 * Written as data rather than scattered `if` statements because the whole
 * value of the state machine is that no caller — a route, a provider
 * adapter, a webhook handler — can invent a transition. There is no
 * `setStatus`; there is only "is this move legal from where the row
 * actually is".
 *
 * Two properties matter most, and both exist because provider events arrive
 * late, out of order and more than once:
 *
 *   READY   never regresses to PROCESSING, however old the event is
 *   DELETED never comes back, whatever the provider later reports
 */

const TRANSITIONS: Readonly<Record<MediaStatus, readonly MediaStatus[]>> = {
  // A logical asset with no provider yet. It can be given an upload target,
  // abandoned, or deleted before anything was ever uploaded.
  CREATED: ["UPLOAD_PENDING", "EXPIRED", "DELETED"],
  UPLOAD_PENDING: ["UPLOADING", "UPLOAD_FAILED", "EXPIRED", "DELETED"],
  UPLOADING: ["PROCESSING", "UPLOAD_FAILED", "DELETED"],
  PROCESSING: ["READY", "PROCESSING_FAILED", "DELETED"],
  // Terminal except for deletion. A late provider status cannot unmake it.
  READY: ["DELETED"],
  UPLOAD_FAILED: ["DELETED"],
  PROCESSING_FAILED: ["DELETED"],
  EXPIRED: ["DELETED"],
  // Absolutely terminal. Deletion is a decision, not a phase.
  DELETED: [],
};

export function allowedTransitionsFrom(
  status: MediaStatus,
): readonly MediaStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: MediaStatus, to: MediaStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * The legal moves from `from` to `to`, in order, or null when no sequence
 * of moves reaches it.
 *
 * A provider is polled, not streamed: between two looks an asset can go
 * from UPLOAD_PENDING straight to what the vendor calls ready. The
 * lifecycle does not admit that jump, and it should not — each state
 * means something to consumers. So the sync walks the intermediate states
 * instead, and every one of them is recorded. DELETED is never walked
 * through: deletion is a decision, not a phase, and no provider answer can
 * imply it.
 */
export function transitionPath(
  from: MediaStatus,
  to: MediaStatus,
): readonly MediaStatus[] | null {
  if (from === to) return [];
  if (to === "DELETED") return canTransition(from, to) ? [to] : null;
  const previous = new Map<MediaStatus, MediaStatus | null>([[from, null]]);
  const queue: MediaStatus[] = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of TRANSITIONS[current]) {
      if (next === "DELETED" || previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path: MediaStatus[] = [];
        for (
          let step: MediaStatus | null = to;
          step !== null && step !== from;
        ) {
          path.unshift(step);
          step = previous.get(step) ?? null;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** True once the provider considers the media playable. Not "publishable". */
export function isReady(status: MediaStatus): boolean {
  return status === "READY";
}

/** True when no further lifecycle progress is possible. */
export function isTerminal(status: MediaStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * A status that means the asset is gone or never arrived. Used to decide
 * whether a company still has a usable pitch, never to judge the company.
 */
export function isUnusable(status: MediaStatus): boolean {
  return (
    status === "DELETED" ||
    status === "EXPIRED" ||
    status === "UPLOAD_FAILED" ||
    status === "PROCESSING_FAILED"
  );
}
