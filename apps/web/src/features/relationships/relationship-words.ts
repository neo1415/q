import type {
  RelationshipStateV2,
  RelationshipSummaryDto,
} from "@capital-q/contracts";
import { formatDay } from "@/components/date-format";

/**
 * How a relationship is said, in one place (CQ-WEB-030; doc 17 §83-§86).
 *
 * Institutional words only. A connection is "both sides have agreed to
 * connect", never a match to celebrate; a decline is "not taken forward",
 * never a rejection. States are words, not colours, and never a score.
 */

export type RelationshipSide = "INVESTOR" | "COMPANY";

export const STATE_WORDS: Readonly<Record<RelationshipStateV2, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest expressed",
  CONNECTED: "Connected",
  DECLINED: "Not taken forward",
  // relationship-state.v2 (2026-10-02): after the first meeting. A pass is
  // "not proceeding for now", never a rejection; Pass is neutral.
  MEETING_HELD: "Met",
  IN_DILIGENCE: "In diligence",
  PAUSED: "Paused",
  PASSED: "Not proceeding for now",
  INVESTED: "Invested",
};

/** What each milestone meant, told from the side reading it. */
export function milestoneSentence(
  state: RelationshipStateV2,
  side: RelationshipSide,
  counterpart: string,
): string {
  switch (state) {
    case "DISCOVERED":
      return side === "INVESTOR"
        ? `You came across ${counterpart}.`
        : `${counterpart} came across your company.`;
    case "INTEREST_EXPRESSED":
      return side === "INVESTOR"
        ? `Your organisation expressed interest in ${counterpart}.`
        : `${counterpart} expressed interest in your company.`;
    case "CONNECTED":
      return "Both sides agreed to connect.";
    case "DECLINED":
      return side === "INVESTOR"
        ? `${counterpart} has not taken this forward.`
        : `Your company did not take this forward.`;
    case "MEETING_HELD":
      return "The first call took place.";
    case "IN_DILIGENCE":
      return "Diligence started.";
    case "PAUSED":
      return "Paused for now.";
    case "PASSED":
      return side === "INVESTOR"
        ? "Your organisation decided not to proceed for now."
        : `${counterpart} decided not to proceed for now.`;
    case "INVESTED":
      return "The investment was confirmed by both sides.";
  }
}

/**
 * Who can see a milestone. The event registry fixes it: a discovery is
 * private to the side that discovered, and every later step is shared by
 * both parties. Said in words beside each entry (doc 17 §84).
 */
export function visibilityWords(
  state: RelationshipStateV2,
  counterpart: string,
): string {
  return state === "DISCOVERED"
    ? "Only your side can see this"
    : `Shared with ${counterpart}`;
}

export function nextStepSentence(
  nextStep: RelationshipSummaryDto["nextStep"],
  counterpart: string,
): string {
  switch (nextStep) {
    case "EXPRESS_INTEREST":
      return `If you want to explore ${counterpart}, express interest. It is not a commitment to invest.`;
    case "AWAIT_ANSWER":
      return `${counterpart} has not answered yet. Nothing is needed from you.`;
    case "ANSWER_INTEREST":
      return `${counterpart} is waiting for your answer: accept to connect, or decline.`;
    case "SCHEDULE_MEETING":
      return `A first call is the natural next step. Book one with ${counterpart} here, or send them a message.`;
    case "DECIDE_NEXT_STEP":
      return `After the call: start diligence, pause, or decide not to proceed for now. Q can record what was agreed.`;
    case "FOLLOW_UP":
      return `Follow up on what was agreed with ${counterpart}: the materials, questions and next call.`;
    case "RESUME":
      return `You paused this. Resume when you're ready.`;
    case "NONE":
      return "Nothing is pending.";
  }
}

/** The next step in a few words, for the "Where things stand" row. */
export const NEXT_STEP_WORDS: Readonly<
  Record<RelationshipSummaryDto["nextStep"], string>
> = {
  EXPRESS_INTEREST: "Express interest",
  AWAIT_ANSWER: "Wait for their answer",
  ANSWER_INTEREST: "Answer their interest",
  SCHEDULE_MEETING: "Book a first call",
  DECIDE_NEXT_STEP: "Decide the next step",
  FOLLOW_UP: "Follow up",
  RESUME: "Resume when ready",
  NONE: "Nothing pending",
};

/** A calendar date as people write it. */
export function formatRelationshipDate(value: string): string {
  return formatDay(value);
}

/** Where a row opens, for the side reading it. */
export function relationshipHref(item: RelationshipSummaryDto): string {
  return item.counterpart.kind === "COMPANY"
    ? `/relationships/company/${item.counterpart.id}`
    : `/relationships/investor/${item.counterpart.id}`;
}

/**
 * The relationships that need the person to act (for UXA's Board "Needs
 * you"). Only a step that is theirs: answering an interest, or the meeting
 * a connection leads to. Waiting is not an item, and neither is an
 * interest the person could express but has not been asked to.
 */
export function relationshipsNeedingYou(
  items: readonly RelationshipSummaryDto[],
): readonly RelationshipSummaryDto[] {
  return items.filter(
    (item) =>
      item.nextStep === "ANSWER_INTEREST" ||
      item.nextStep === "SCHEDULE_MEETING" ||
      item.nextStep === "DECIDE_NEXT_STEP" ||
      item.nextStep === "FOLLOW_UP",
  );
}

/**
 * What a relationship page says when there is no relationship to show:
 * a failure to load only when the read failed; otherwise that nothing is
 * on record yet (founder or investor side, from "your company" or "your
 * organisation").
 */
export function absentSentence(
  loaded: boolean,
  own: "company" | "organisation",
  counterpart: string,
): string {
  return loaded
    ? `Nothing is on record yet between your ${own} and ${counterpart}.`
    : "Where you stand couldn't load just now. Nothing has changed; try again in a moment.";
}
