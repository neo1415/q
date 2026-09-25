import type {
  RelationshipStateV1,
  RelationshipSummaryDto,
} from "@capital-q/contracts";

/**
 * How a relationship is said, in one place (CQ-WEB-030; doc 17 §83-§86).
 *
 * Institutional words only. A connection is "both sides have agreed to
 * connect", never a match to celebrate; a decline is "not taken forward",
 * never a rejection. States are words, not colours, and never a score.
 */

export type RelationshipSide = "INVESTOR" | "COMPANY";

export const STATE_WORDS: Readonly<Record<RelationshipStateV1, string>> = {
  DISCOVERED: "Discovered",
  INTEREST_EXPRESSED: "Interest expressed",
  CONNECTED: "Connected",
  DECLINED: "Not taken forward",
};

/** What each milestone meant, told from the side reading it. */
export function milestoneSentence(
  state: RelationshipStateV1,
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
  }
}

/**
 * Who can see a milestone. The event registry fixes it: a discovery is
 * private to the side that discovered, and every later step is shared by
 * both parties. Said in words beside each entry (doc 17 §84).
 */
export function visibilityWords(
  state: RelationshipStateV1,
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
      return `A first meeting is the natural next step. Scheduling inside Capital Q is not available yet, so arrange it with ${counterpart} directly.`;
    case "NONE":
      return "Nothing is pending.";
  }
}

/** A calendar date as people write it. */
export function formatRelationshipDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
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
      item.nextStep === "SCHEDULE_MEETING",
  );
}
