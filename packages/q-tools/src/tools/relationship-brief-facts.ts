import type {
  RelationshipBrief,
  RelationshipBriefMeeting,
  RelationshipBriefMessage,
} from "@capital-q/contracts";

/**
 * The Relationship Brief as plain sentences, written by code (R1). Q
 * relays these for "did they write back?", "did they accept the call?":
 * the fact is decided here, from the brief, not by a model reading
 * absence. Each sentence states what is known, and an UNAVAILABLE source
 * is said to be unknown -- never "none" (TensorGate, 2026-10-09).
 *
 * Times are UTC ISO minutes; the model may restate them in the person's
 * zone, never change them.
 */

function at(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function who(message: RelationshipBriefMessage, counterpart: string): string {
  switch (message.from) {
    case "YOU":
      return message.viaQ ? "you (sent by Q)" : "you";
    case "YOUR_SIDE":
      return `${message.senderName} on your side`;
    case "OTHER_SIDE":
      return `${message.senderName} at ${counterpart}`;
  }
}

function meetingLine(meeting: RelationshipBriefMeeting): string {
  const when = at(meeting.startsAt);
  if (meeting.status === "CANCELLED")
    return `A call for ${when} was cancelled.`;
  if (meeting.status === "SCHEDULING") {
    return `A call for ${when} is being booked (not yet confirmed).`;
  }
  return meeting.timing === "UPCOMING"
    ? `A call is booked (scheduled) for ${when}.`
    : `A call was booked for ${when} (now past; whether it was held is not recorded).`;
}

export function briefFacts(brief: RelationshipBrief): readonly string[] {
  const them = brief.counterparty.name ?? "the other side";
  const facts: string[] = [];
  if (brief.state !== null) {
    facts.push(
      `Relationship with ${them}: ${brief.state.state} since ${at(brief.state.stateSince)}.`,
    );
  }

  const { count, latest } = brief.messages;
  if (latest.status === "OK") {
    if (count === 0 && latest.message === null) {
      facts.push(`No messages have been sent in the chat with ${them}.`);
    } else {
      const last = latest.message;
      facts.push(
        last === null
          ? `${count} message(s) recorded in the chat with ${them}.`
          : `${count} message(s) in the chat with ${them}; the latest was sent by ${who(last, them)} at ${at(last.sentAt)}.`,
      );
      const fromThem = latest.fromThem;
      if (fromThem === null) {
        facts.push(`${them} has not written in the chat yet.`);
      } else if (last !== null && fromThem.sentAt !== last.sentAt) {
        facts.push(`${them} last wrote at ${at(fromThem.sentAt)}.`);
      }
    }
  } else {
    facts.push(
      count > 0
        ? `${count} message(s) are recorded in the chat with ${them}; who wrote last could not be read right now.`
        : `The chat with ${them} could not be read right now, so whether anything was said is unknown.`,
    );
  }

  if (brief.meetings.status === "OK") {
    if (brief.meetings.items.length === 0) {
      facts.push(`No call has been booked with ${them}.`);
    } else {
      for (const meeting of brief.meetings.items.slice(-4)) {
        facts.push(meetingLine(meeting));
      }
    }
  } else {
    facts.push(`Calls with ${them} could not be read right now; unknown.`);
  }

  if (brief.obligations.status === "OK") {
    const open = brief.obligations.openRequests;
    if (open.length > 0) {
      facts.push(
        `Open diligence requests: ${open
          .map((r) => r.title)
          .slice(0, 5)
          .join("; ")}.`,
      );
    }
  } else {
    facts.push("Diligence requests could not be read right now; unknown.");
  }

  for (const decision of brief.pendingDecisions.items) {
    const since =
      decision.since === null ? "" : ` (since ${at(decision.since)})`;
    facts.push(
      decision.owner === "YOU"
        ? `Waiting on you: ${decision.kind}${since}.`
        : `Waiting on ${them}: ${decision.kind}${since}.`,
    );
  }
  return facts.slice(0, 16);
}
