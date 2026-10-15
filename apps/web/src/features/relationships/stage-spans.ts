import type { RelationshipStatusDto } from "@capital-q/contracts";

/**
 * How long a relationship has spent in each stage, from its own milestones
 * (the per-party fold): each stage runs from its milestone to the next one,
 * the current stage to when the page was read. Nothing is estimated; a
 * relationship with one milestone has no history to draw.
 */

export type StageSpan = {
  readonly key: string;
  readonly state: RelationshipStatusDto["state"];
  readonly from: string;
  /** Null: the stage it is in now. */
  readonly to: string | null;
  readonly ms: number;
};

const DAY = 86_400_000;

export function stageSpans(
  milestones: RelationshipStatusDto["milestones"],
  now: number,
): readonly StageSpan[] {
  const ordered = milestones
    .filter((milestone) => !Number.isNaN(Date.parse(milestone.at)))
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ordered.length < 2) return [];
  return ordered.map((milestone, at) => {
    const next = ordered[at + 1];
    const end = next === undefined ? now : Date.parse(next.at);
    return {
      key: `${milestone.state}:${milestone.at}`,
      state: milestone.state,
      from: milestone.at,
      to: next?.at ?? null,
      ms: Math.max(0, end - Date.parse(milestone.at)),
    };
  });
}

/** "3 days", "under a day": whole days, never a fraction. */
export function durationWords(ms: number): string {
  if (ms < DAY) return "under a day";
  const days = Math.floor(ms / DAY);
  return days === 1 ? "1 day" : `${String(days)} days`;
}
