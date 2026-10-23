import { createHash } from "node:crypto";

/**
 * Owner 2026-10-23: Discover must not hard-cap.
 *
 * Every dimension used to read `order by id limit 200`: of the 381
 * companies that qualified for pre-seed to Series A, the 355th by id was
 * never a candidate, so never ranked, never shown. Candidate generation
 * now walks a seeded rotation in windows. Each company falls in exactly
 * one window: md5(seed || id), its first eight hex digits read as an
 * unsigned integer, modulo the number of windows. The seed is the investor
 * organisation, so the order is fair across companies, stable for one
 * investor and reproducible; one slate is built from one window, and the
 * feed goes on to the next window when an investor reaches the end of it
 * (`SLATE_CONTINUED`), back to the first after the last.
 *
 * The companies port applies the same arithmetic in SQL; this is the
 * in-memory form, for a dimension whose source cannot (taxonomy).
 */

/** Companies per window, aimed for: room under the dimension and pool caps. */
export const CANDIDATE_WINDOW_TARGET = 100;

export type CandidateWindow = {
  readonly seed: string;
  readonly index: number;
  readonly of: number;
};

/** How many windows `qualifying` companies need. Never fewer than one. */
export function candidateWindowCount(qualifying: number): number {
  return Math.max(
    1,
    Math.ceil(Math.max(0, qualifying) / CANDIDATE_WINDOW_TARGET),
  );
}

/** The window `companyId` falls in under `seed`, of `of`. */
export function candidateWindowOf(
  seed: string,
  companyId: string,
  of: number,
): number {
  if (of <= 1) return 0;
  const hex = createHash("md5")
    .update(`${seed}${companyId}`)
    .digest("hex")
    .slice(0, 8);
  return Number.parseInt(hex, 16) % of;
}

/** Window `index` (any integer) as a window of `of`. */
export function candidateWindow(
  seed: string,
  index: number,
  of: number,
): CandidateWindow {
  const count = Math.max(1, Math.trunc(of));
  const at = ((Math.trunc(index) % count) + count) % count;
  return { seed, index: at, of: count };
}
