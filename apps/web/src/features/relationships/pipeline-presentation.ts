import type {
  RelationshipStateV2,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

type PipelineState = RelationshipStateV2;

/**
 * The Board's columns, left to right: the deal's forward path first, then
 * the states where it stopped (paused, not proceeding, not taken forward),
 * so a closed relationship never sits between two live stages. Every
 * relationship state appears exactly once (asserted in the pipeline tests).
 */
export const BOARD_STATES: readonly PipelineState[] = [
  "DISCOVERED",
  "INTEREST_EXPRESSED",
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "INVESTED",
  "PAUSED",
  "PASSED",
  "DECLINED",
];

/** Where the forward path ends on the Board: these columns read as closed. */
export const BOARD_STOPPED: ReadonlySet<PipelineState> = new Set([
  "PAUSED",
  "PASSED",
  "DECLINED",
]);

/** Board grouping changes presentation order, never canonical relationship state. */
export function pipelinePresentedRows(
  items: readonly RelationshipSummaryDto[],
  layout: "table" | "board",
): readonly RelationshipSummaryDto[] {
  return layout === "table"
    ? items
    : BOARD_STATES.flatMap((state) =>
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
