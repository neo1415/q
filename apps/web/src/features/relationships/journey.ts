import type { RelationshipStatusDto } from "@capital-q/contracts";

/**
 * Where a relationship is on its way, for the hero's progress (design-48).
 * Presentation over the server's per-party fold: the furthest step the
 * current state or any milestone reached. Words always carry the state;
 * the bar repeats it. A paused or passed relationship keeps the step it
 * reached; one that was not taken forward shows no progress at all.
 */
export const JOURNEY = [
  { label: "Interest", states: ["INTEREST_EXPRESSED"] },
  { label: "Connected", states: ["CONNECTED"] },
  { label: "Met", states: ["MEETING_HELD"] },
  { label: "Diligence", states: ["IN_DILIGENCE"] },
  { label: "Invested", states: ["INVESTED"] },
] as const;

type State = RelationshipStatusDto["state"];

const stepOf = (state: State): number =>
  JOURNEY.findIndex((step) =>
    (step.states as readonly string[]).includes(state),
  );

/** 1-based step reached, or null when progress doesn't apply. */
export function journeyStep(
  relationship: Pick<RelationshipStatusDto, "state" | "milestones">,
): number | null {
  if (relationship.state === "DECLINED") return null;
  const reached = Math.max(
    stepOf(relationship.state),
    ...relationship.milestones.map((milestone) => stepOf(milestone.state)),
  );
  return reached < 0 ? null : reached + 1;
}
