import type { RelationshipStatusDto } from "@capital-q/contracts";

import { formatRelationshipDate } from "./relationship-words";

type Milestone = RelationshipStatusDto["milestones"][number];

/**
 * One line of "What happened": a milestone, or a short pattern of them that
 * repeated back-to-back on one day.
 *
 * Real use is messy -- a pass and a reconnect clicked four times in a
 * morning, a retried action. Each event still happened and stays in the
 * history (append-only; nothing here edits it): the page shows it once with
 * how many times it happened, rather than a wall of identical lines. A
 * repeat that alternates (pass, reconnect, pass, reconnect) is a period-2
 * pattern and is shown as the pair, so the contradiction stays visible.
 */
export type TimelineRun = {
  /** One milestone, or the two that alternated, in order. */
  readonly steps: readonly Milestone[];
  /** How many times the steps happened in a row (1 = no repeat). */
  readonly times: number;
  /** When the last repeat happened. */
  readonly lastAt: string;
};

const MAX_PERIOD = 2;

function samePattern(
  milestones: readonly Milestone[],
  start: number,
  offset: number,
  period: number,
  day: string,
): boolean {
  for (let k = 0; k < period; k += 1) {
    const a = milestones[start + k];
    const b = milestones[offset + k];
    if (a === undefined || b === undefined) return false;
    if (a.state !== b.state) return false;
    if (formatRelationshipDate(b.at) !== day) return false;
  }
  return true;
}

export function timelineRuns(
  milestones: readonly Milestone[],
): readonly TimelineRun[] {
  const runs: TimelineRun[] = [];
  let i = 0;
  while (i < milestones.length) {
    const first = milestones[i];
    if (first === undefined) break;
    const day = formatRelationshipDate(first.at);
    let best: { period: number; times: number } = { period: 1, times: 1 };
    for (let period = 1; period <= MAX_PERIOD; period += 1) {
      // The pattern itself must sit inside one day too.
      if (!samePattern(milestones, i, i, period, day)) continue;
      let times = 1;
      while (samePattern(milestones, i, i + times * period, period, day)) {
        times += 1;
      }
      if (times > 1 && times * period > best.times * best.period) {
        best = { period, times };
      }
    }
    const steps = milestones.slice(i, i + best.period);
    const consumed = best.period * best.times;
    const last = milestones[i + consumed - 1] ?? first;
    runs.push({ steps, times: best.times, lastAt: last.at });
    i += consumed;
  }
  return runs;
}
