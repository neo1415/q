import type {
  ArrivalSnapshot,
  ArrivalSnapshotItem,
} from "@capital-q/contracts";
import type { AuthorisedFact } from "@capital-q/q-core";

/**
 * W1: what Q just told them on arrival, as one prepared fact for the
 * model. The welcome said "You have a request from TensorGate"; a
 * follow-up ("what's the request?", "what did they say?", "did they
 * accept?") is answered from here, with no tool read and no delegation.
 *
 * The snapshot is the person's own authorised read (built for their actor
 * only), already bounded: only the latest messages' previews, never a
 * thread. This text is data, not instructions: it states what was read and
 * from where, and says UNAVAILABLE where a detail could not be read.
 */

const STATEMENT_MAX = 3_500;
const ITEMS_MAX = 8;

const oneLine = (text: string, max: number): string => {
  const clean = text.replace(/\s+/gu, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
};

function when(iso: string | null): string {
  return iso === null
    ? "an unknown time"
    : iso.slice(0, 16).replace("T", " ") + " UTC";
}

function itemLines(item: ArrivalSnapshotItem, index: number): string {
  const f = item.facts;
  const bits: string[] = [
    `${String(index + 1)}. "${oneLine(item.headline, 200)}" (${item.kind.toLowerCase().replace(/_/gu, " ")}, since ${when(item.since)})`,
  ];
  if (item.availability === "UNAVAILABLE") {
    bits.push(
      "UNAVAILABLE: the detail behind this could not be read just now; say you could not check it, do not guess.",
    );
  }
  if (f.request !== null) {
    bits.push(
      `The request: ${oneLine(f.request.summary, 300)}${f.request.from === null ? "" : ` (from ${oneLine(f.request.from, 120)})`}.`,
    );
  }
  if (f.relationshipState !== null) {
    bits.push(
      `Relationship state: ${f.relationshipState.toLowerCase().replace(/_/gu, " ")}.`,
    );
  }
  if (f.messageCount !== null) {
    bits.push(
      f.messageCount === 0
        ? "No messages have been sent on the thread."
        : `${String(f.messageCount)} message${f.messageCount === 1 ? "" : "s"} sent on the thread.`,
    );
  }
  const them = f.theirLatestMessage;
  if (them !== null) {
    bits.push(
      `Their latest message (${oneLine(them.senderName, 80)}, ${when(them.sentAt)})${them.text === null ? " has no preview" : `: "${oneLine(them.text, 240)}"`}.`,
    );
  }
  const last = f.latestMessage;
  if (last !== null && (them === null || last.sentAt !== them.sentAt)) {
    bits.push(
      `Latest message overall, from ${last.from === "YOU" ? "you" : last.from === "OTHER_SIDE" ? "the other side" : "your side"} (${oneLine(last.senderName, 80)}, ${when(last.sentAt)}, ${last.viaQ ? "sent by Q" : "sent"})${last.text === null ? "" : `: "${oneLine(last.text, 240)}"`}.`,
    );
  }
  if (f.meeting !== null) {
    const m = f.meeting;
    bits.push(
      `Call: ${m.status.toLowerCase()}, ${m.timing === "UPCOMING" ? "upcoming" : "past"}, ${when(m.startsAt)} to ${when(m.endsAt)}${m.booked ? "; it is booked, so the time is confirmed on both calendars (separate accept clicks are not tracked)" : ""}.`,
    );
  } else if (item.kind === "MEETING" || item.kind === "INTEREST_REQUEST") {
    bits.push("No call is booked.");
  }
  if (f.decisions.length > 0) {
    bits.push(
      `Decisions: ${f.decisions
        .slice(0, 4)
        .map(
          (d) =>
            `${oneLine(d.label, 80)} (${d.owner === "YOU" ? "yours" : "theirs"})`,
        )
        .join("; ")}.`,
    );
  }
  if (f.openRequests.length > 0) {
    bits.push(
      `Open requests: ${f.openRequests
        .slice(0, 4)
        .map((r) => `"${oneLine(r.title, 100)}"`)
        .join("; ")}.`,
    );
  }
  if (f.documents.length > 0) {
    bits.push(
      `Documents: ${f.documents
        .slice(0, 4)
        .map((d) => `"${oneLine(d.title, 100)}"`)
        .join("; ")}.`,
    );
  }
  if (f.suggestedNextAction !== null) {
    bits.push(
      `Suggested next step: ${oneLine(f.suggestedNextAction.label, 100)}.`,
    );
  }
  if (f.note !== null) bits.push(`Note: ${oneLine(f.note, 300)}`);
  if (item.openPath !== null) bits.push("Their conversation can be opened.");
  return bits.join(" ");
}

export function arrivalSnapshotFact(
  snapshot: ArrivalSnapshot | null,
): AuthorisedFact | null {
  if (snapshot === null || snapshot.items.length === 0) return null;
  const lines = snapshot.items.slice(0, ITEMS_MAX).map(itemLines);
  const unread =
    snapshot.unread.length === 0
      ? ""
      : ` Could not be checked: ${snapshot.unread.map((u) => u.toLowerCase().replace(/_/gu, " ")).join(", ")}.`;
  const statement = [
    `What Q already told them on arrival (already read for them, version ${snapshot.version.slice(0, 12)}, as of ${when(snapshot.asOf)}). Questions about these items ("what's the request", "what did they say", "did they accept", "open the conversation") are answered from here: do not look them up again, call a tool, or hand them to anyone; say plainly what is not here.`,
    ...lines,
    unread,
  ]
    .join("\n")
    .slice(0, STATEMENT_MAX);
  return {
    scope: "ARRIVAL_SNAPSHOT",
    statement,
    truthClass: "VERIFIED",
    evidenceStatus: "PLATFORM_VERIFIED",
    source:
      "Capital Q arrival snapshot (their own relationships, messages, calls and approvals)",
    asOf: snapshot.asOf.slice(0, 40),
  };
}
