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
