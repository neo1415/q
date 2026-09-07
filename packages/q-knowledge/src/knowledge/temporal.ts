import type { UtcTimestamp } from "@capital-q/contracts";

/**
 * Time in the knowledge layer (CQ-KNW-003 §6-§8).
 *
 * Two clocks, never conflated:
 *
 *   valid time    when the information applies to the world
 *   record time   when Capital Q came to hold it
 *
 * `created_at` answers "when did we write this down", which is almost never
 * the question being asked. "What was ARR in June?" is a question about
 * valid time, and answering it from record time gives whatever we happened
 * to learn most recently, which may be about August.
 */

export type KnowledgePeriod = {
  /** When the information starts applying. Null: the source gave no period. */
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  /** When Capital Q recorded it. Always present. */
  readonly recordedAt: UtcTimestamp;
};

/**
 * The instant an understanding starts to apply.
 *
 * An undated assertion is about the moment it was made — a founder saying
 * "our ARR is 2.4m" today is speaking about today — so `recorded_at` stands
 * in. This is the same expression the database orders by, so application
 * and index agree about what "latest" means.
 */
export function effectiveFrom(period: KnowledgePeriod): number {
  return Date.parse(period.validFrom ?? period.recordedAt);
}

/** The instant it stops applying, or +infinity while it still does. */
export function effectiveTo(period: KnowledgePeriod): number {
  return period.validTo === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(period.validTo);
}

/**
 * Whether two understandings describe the same stretch of time.
 *
 * Deliberately strict about what counts as "the same": an open-ended
 * assertion (`validTo` null) overlaps everything after its start, which is
 * why a June figure and an August figure that are both open-ended DO
 * overlap — and why the packet's growth example needs its periods stated.
 * Where a source gave no period at all, the assertions are compared as
 * undated, and two undated assertions about the same metric are about the
 * same thing.
 */
export function periodsOverlap(
  a: KnowledgePeriod,
  b: KnowledgePeriod,
): boolean {
  const aFrom = effectiveFrom(a);
  const bFrom = effectiveFrom(b);
  // Two dated assertions that start at different instants describe
  // different points in a series. January ARR and August ARR are both true.
  if (a.validFrom !== null && b.validFrom !== null && aFrom !== bFrom) {
    // ...unless one explicitly spans the other's start.
    return aFrom < bFrom ? effectiveTo(a) > bFrom : effectiveTo(b) > aFrom;
  }
  return true;
}

/** Whether two understandings are about exactly the same period. */
export function samePeriod(a: KnowledgePeriod, b: KnowledgePeriod): boolean {
  const bothUndated = a.validFrom === null && b.validFrom === null;
  if (bothUndated) {
    return true;
  }
  if (a.validFrom === null || b.validFrom === null) {
    return false;
  }
  return (
    Date.parse(a.validFrom) === Date.parse(b.validFrom) &&
    effectiveTo(a) === effectiveTo(b)
  );
}

/**
 * Whether a candidate restates a period already recorded (§8, §44).
 *
 * A correction and a new value look identical if you only compare numbers.
 * The difference is the period: "June was 1.75m, not 1.8m" is a correction;
 * "August is 2.4m" is growth. Reporting the first as a decline is a bug that
 * would libel the subject.
 */
export function isCorrectionOf(
  candidate: KnowledgePeriod,
  existing: KnowledgePeriod,
): boolean {
  return (
    samePeriod(candidate, existing) &&
    Date.parse(candidate.recordedAt) >= Date.parse(existing.recordedAt)
  );
}

/**
 * Picks the understanding that applies at an instant.
 *
 * `asOf` selects the latest one whose validity had begun by then and had not
 * ended — never simply the newest row, and never a value from the future of
 * the question. Ties on effective date break on record time, so the most
 * recently learned reading of the same period wins, which is what a
 * correction is.
 */
export function selectAsOf<T extends KnowledgePeriod>(
  candidates: readonly T[],
  asOf: Date,
): T | null {
  const at = asOf.getTime();
  let chosen: T | null = null;
  for (const candidate of candidates) {
    const from = effectiveFrom(candidate);
    if (from > at || effectiveTo(candidate) <= at) {
      continue;
    }
    if (chosen === null) {
      chosen = candidate;
      continue;
    }
    const chosenFrom = effectiveFrom(chosen);
    if (
      from > chosenFrom ||
      (from === chosenFrom &&
        Date.parse(candidate.recordedAt) > Date.parse(chosen.recordedAt))
    ) {
      chosen = candidate;
    }
  }
  return chosen;
}

/** The understanding that applies now. `selectAsOf` at the current instant. */
export function selectCurrent<T extends KnowledgePeriod>(
  candidates: readonly T[],
  now: Date = new Date(),
): T | null {
  return selectAsOf(candidates, now);
}
