import type {
  CompanyDeckView,
  DataRoomView,
  RelationshipBrief,
  RelationshipStatusDto,
} from "@capital-q/contracts";

import type { ArrivalFact } from "./arrival-news";

/**
 * W5.2: what is material on each page, declared in code (never a model's
 * call). Only what the other side or the world did is news to this
 * person; their own sends and uploads are not. A source that was not read
 * is unknown (null), never "nothing".
 */

/** A relationship's page, from its brief and its projected state. */
export function relationshipArrivalFacts(
  brief: RelationshipBrief | null,
  relationship: RelationshipStatusDto | null,
  counterpart: string,
): ArrivalFact[] {
  const facts: ArrivalFact[] = [
    {
      key: "stage",
      value: relationship?.state ?? null,
      news: "CHANGED",
      line: "This relationship has moved to a new stage since you were last here.",
      ask: "What changed in this relationship since I last looked?",
    },
  ];
  if (brief === null) return facts;
  const messages = brief.messages.latest;
  facts.push({
    key: "their-message",
    // Known "none" is a value: their first message is news.
    value:
      messages.status === "OK" ? (messages.fromThem?.sentAt ?? "none") : null,
    news: "CHANGED",
    subject: counterpart,
    line: "sent a new message since you were last here.",
    ask: "What did they say in their latest message?",
  });
  const meetings = brief.meetings;
  facts.push({
    key: "their-calls",
    value:
      meetings.status === "OK"
        ? meetings.items.filter((meeting) => !meeting.organisedByYou).length
        : null,
    news: "INCREASED",
    subject: counterpart,
    line: "booked a call since you were last here.",
    ask: "What is the call they booked about, and what should I prepare?",
  });
  facts.push({
    key: "decisions-on-you",
    // A partial list is not a count to compare.
    value: brief.pendingDecisions.complete
      ? brief.pendingDecisions.items.filter((one) => one.owner === "YOU").length
      : null,
    news: "INCREASED",
    line: "A new decision is waiting on you here.",
    ask: "What decision is waiting on me here?",
  });
  if (brief.yourSide === "INVESTOR") {
    const documents = brief.documents;
    facts.push({
      key: "documents-shared",
      value: documents.status === "OK" ? documents.items.length : null,
      news: "INCREASED",
      subject: counterpart,
      line: "shared new documents with you since you were last here.",
      ask: "What did they share, and what stands out?",
    });
  } else {
    const obligations = brief.obligations;
    facts.push({
      key: "requests-open",
      value:
        obligations.status === "OK"
          ? obligations.openRequests.length + obligations.answeredCount
          : null,
      news: "INCREASED",
      subject: counterpart,
      line: "asked for something new in diligence since you were last here.",
      ask: "What did they ask for in diligence, and what do we have ready?",
    });
  }
  return facts;
}

/** A company's page as an investor reads it: its deck and its room. */
export function companyArrivalFacts(
  deck: CompanyDeckView | null,
  dataRoom: DataRoomView | null,
  name: string,
): ArrivalFact[] {
  // The owner's own uploads are not news to the owner.
  if (deck?.viewer === "OWNER" || dataRoom?.viewer === "OWNER") return [];
  return [
    {
      key: "deck-version",
      value: deck === null ? null : (deck.deck?.versionNumber ?? 0),
      news: "INCREASED",
      subject: name,
      line: "posted a new deck since you were last here.",
      ask: "What changed in their latest deck?",
    },
    {
      key: "data-room",
      value:
        dataRoom === null
          ? null
          : dataRoom.documents.filter((one) => one.access === "OPEN").length,
      news: "INCREASED",
      subject: name,
      line: "added documents you can open in their data room since you were last here.",
      ask: "What did they add to their data room?",
    },
  ];
}
