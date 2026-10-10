import type { ChatThreadDto, RelationshipBrief } from "@capital-q/contracts";

import { formatRelationshipDate } from "./relationship-words";

/**
 * The overview's "where it stands" lines, written by code from the
 * Relationship Brief (R1) -- the same read Q answers from. A source the
 * brief marks UNAVAILABLE reads as unknown, never as "none" (TensorGate,
 * 2026-10-09: a failed chat read was told as "no message has been sent").
 */
export function briefLines(
  brief: RelationshipBrief,
  counterpart: string,
): readonly string[] {
  const lines: string[] = [];

  const count = brief.messages.count;
  const latest = brief.messages.latest;
  const counted =
    count === 0
      ? "No messages yet"
      : `${count} message${count === 1 ? "" : "s"}`;
  if (latest.status === "UNAVAILABLE") {
    lines.push(
      count === 0
        ? "Messages couldn't be read just now"
        : `${counted}; the latest couldn't be read just now`,
    );
  } else if (latest.message === null) {
    lines.push(counted);
  } else {
    const who =
      latest.message.from === "YOU"
        ? "you"
        : latest.message.from === "YOUR_SIDE"
          ? latest.message.senderName
          : counterpart;
    lines.push(
      `${counted}, latest from ${who} on ${formatRelationshipDate(latest.message.sentAt)}`,
    );
  }

  const meetings = brief.meetings;
  if (meetings.status === "UNAVAILABLE") {
    lines.push("Calls couldn't be read just now");
  } else if (meetings.nextScheduled !== null) {
    lines.push(
      `Call booked for ${formatRelationshipDate(meetings.nextScheduled.startsAt)}`,
    );
  } else {
    const past = meetings.items
      .filter((m) => m.status === "SCHEDULED" && m.timing === "PAST")
      .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
    if (past?.noShow === true) {
      // Recorded on the history as not having taken place (meeting_no_show).
      lines.push(
        `The call on ${formatRelationshipDate(past.startsAt)} didn't take place`,
      );
    } else if (past !== undefined) {
      lines.push(`Last call ${formatRelationshipDate(past.startsAt)}`);
    } else if (meetings.items.length === 0) {
      lines.push("No call booked");
    } else {
      lines.push("No call booked now");
    }
  }

  const obligations = brief.obligations;
  if (obligations.status === "OK" && obligations.openRequests.length > 0) {
    const open = obligations.openRequests.length;
    lines.push(`${open} diligence request${open === 1 ? "" : "s"} open`);
  }

  return lines;
}

/**
 * The Messages tab's count: the brief's, over the whole history (R1); the
 * thread's first page only when the brief could not be read.
 */
export function messageCountOf(loaded: {
  readonly brief: RelationshipBrief | null;
  readonly thread: ChatThreadDto | null;
}): number {
  return loaded.brief?.messages.count ?? loaded.thread?.messages.length ?? 0;
}
