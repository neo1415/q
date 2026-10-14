import {
  RELATIONSHIP_STATES_V2,
  type RelationshipSummaryDto,
} from "@capital-q/contracts";

/** Board grouping changes presentation order, never canonical relationship state. */
export function pipelinePresentedRows(
  items: readonly RelationshipSummaryDto[],
  layout: "table" | "board",
): readonly RelationshipSummaryDto[] {
  return layout === "table"
    ? items
    : RELATIONSHIP_STATES_V2.flatMap((state) =>
        items.filter((row) => row.state === state),
      );
}
export const PIPELINE_NEXT_WORDS: Readonly<
  Record<RelationshipSummaryDto["nextStep"], string>
> = {
  EXPRESS_INTEREST: "Express interest",
  AWAIT_ANSWER: "Awaiting a response",
  ANSWER_INTEREST: "Respond to interest",
  SCHEDULE_MEETING: "Arrange a meeting",
  NONE: "No next step recorded",
  DECIDE_NEXT_STEP: "Review next steps",
  FOLLOW_UP: "Follow up",
  RESUME: "Review the relationship",
};
