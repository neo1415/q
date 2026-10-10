import type {
  ArrivalSnapshot,
  ArrivalSnapshotItem,
} from "@capital-q/contracts";

/**
 * W1 (fix): a follow-up on what Q just told them on arrival ("what's the
 * request?", "what did they say?", "did they accept the time?") is
 * answered by code from the Arrival Snapshot: a prepared-context answer
 * with no tool and no model round. Pure. Returns null when the turn is not
 * such a follow-up or does not point at exactly one arrival item, so the
 * normal path handles it.
 */

/**
 * A cheap gate before TURN_SKIM is asked about an arrival follow-up: a
 * pointing word ("they", "it", "the meeting", Nigerian-English "dem",
 * "wetin") or a proper noun after the first word. Most turns fail it and
 * cost nothing.
 */
export function pointsAtArrival(text: string): boolean {
  if (
    /\b(?:they|them|their|he|she|it|that|this|dem|wetin|abeg|request|ask|meeting|call|time|slot|message|reply|replied|word|back|agree[ds]?|accept(?:ed)?|confirm(?:ed)?|offer|next)\b/iu.test(
      text,
    )
  ) {
    return true;
  }
  return /\s[A-Z][A-Za-z]{2,}/u.test(text);
}

export type ArrivalFollowUp = "REQUEST" | "SAID" | "ACCEPTED";

const REQUEST =
  /\b(?:what(?:'s|s| is| was)\s+(?:the|that|this|their)\s+(?:request|ask)|what\s+(?:do|did|does)\s+(?:they|he|she)\s+(?:want|ask)|what\s+are\s+they\s+(?:asking|requesting)|what\s+is\s+(?:the\s+)?request\s+about)\b/iu;
const SAID =
  /\b(?:what\s+(?:did|do|does)\s+(?:they|he|she)\s+(?:say|write|send|reply)|what(?:'s|s| is| was)\s+(?:their|the)\s+(?:message|reply|note))\b/iu;
const ACCEPTED =
  /\b(?:(?:did|have|has|do|does)\s+(?:they|he|she)\s+(?:accept|confirm|agree|take)|is\s+(?:the|my|that)\s+(?:call|meeting|time|slot)\s+(?:booked|confirmed|set|accepted))\b/iu;

export function arrivalFollowUpKind(text: string): ArrivalFollowUp | null {
  if (REQUEST.test(text)) return "REQUEST";
  if (SAID.test(text)) return "SAID";
  if (ACCEPTED.test(text)) return "ACCEPTED";
  return null;
}

function target(
  text: string,
  snapshot: ArrivalSnapshot,
): ArrivalSnapshotItem | null {
  const lower = text.toLowerCase();
  const candidates = snapshot.items.filter((item) => item.counterpart !== null);
  const named = candidates.filter((item) => {
    const name = item.counterpart?.name?.toLowerCase();
    return name !== undefined && name.length > 1 && lower.includes(name);
  });
  if (named.length === 1) return named[0] ?? null;
  if (named.length > 1) return null;
  // A deictic follow-up right after the welcome points at its one item.
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

const when = (iso: string | null): string =>
  iso === null
    ? "an unknown time"
    : `${iso.slice(0, 16).replace("T", " ")} UTC`;

export type ArrivalAspect =
  "REQUEST" | "THEIR_MESSAGE" | "MEETING" | "NEXT_STEP";

/**
 * The semantic path: TURN_SKIM named the item (by its key) and the aspect.
 * Null when the snapshot does not hold that item, so the normal path runs.
 */
export function arrivalAspectAnswer(
  snapshot: ArrivalSnapshot | null,
  itemKey: string,
  aspect: ArrivalAspect,
): { readonly text: string; readonly itemKey: string } | null {
  const item = snapshot?.items.find((one) => one.key === itemKey);
  if (item === undefined || item.counterpart === null) return null;
  if (aspect === "NEXT_STEP") {
    const next = item.facts.suggestedNextAction;
    const name = item.counterpart.name ?? "them";
    if (item.availability === "UNAVAILABLE" || next === null) {
      return item.availability === "UNAVAILABLE"
        ? unavailable(item)
        : {
            itemKey: item.key,
            text: `There is nothing waiting on you with ${name} right now.`,
          };
    }
    return {
      itemKey: item.key,
      text: `With ${name}: ${next.label}${next.owner === "THEM" ? " (waiting on them)" : ""}.`,
    };
  }
  return answerFor(
    aspect === "REQUEST"
      ? "REQUEST"
      : aspect === "THEIR_MESSAGE"
        ? "SAID"
        : "ACCEPTED",
    item,
  );
}

function unavailable(item: ArrivalSnapshotItem) {
  return {
    itemKey: item.key,
    text: `I couldn't read the details behind "${item.headline}" just now, so I won't guess. Try again in a moment, or open the conversation.`,
  };
}

export function arrivalFollowUpAnswer(
  text: string,
  snapshot: ArrivalSnapshot | null,
): { readonly text: string; readonly itemKey: string } | null {
  if (snapshot === null) return null;
  const kind = arrivalFollowUpKind(text);
  if (kind === null) return null;
  const item = target(text, snapshot);
  if (item === null) return null;
  return answerFor(kind, item);
}

function answerFor(
  kind: ArrivalFollowUp,
  item: ArrivalSnapshotItem,
): { readonly text: string; readonly itemKey: string } | null {
  const name = item.counterpart?.name ?? "They";
  const f = item.facts;
  if (item.availability === "UNAVAILABLE") return unavailable(item);
  switch (kind) {
    case "REQUEST": {
      const request = f.request;
      if (request === null) return null;
      const said = f.theirLatestMessage?.text;
      return {
        itemKey: item.key,
        text: `${request.summary}${request.since === null ? "" : ` (since ${when(request.since)})`}.${said == null ? "" : ` Their latest message: "${said}"`}`,
      };
    }
    case "SAID": {
      const m = f.theirLatestMessage;
      return {
        itemKey: item.key,
        text:
          m === null
            ? `${name} hasn't sent a message on your thread.`
            : m.text === null
              ? `${name} sent a ${m.kind.toLowerCase().replace("_", " ")} at ${when(m.sentAt)}.`
              : `${m.senderName} wrote at ${when(m.sentAt)}: "${m.text}"`,
      };
    }
    case "ACCEPTED": {
      const m = f.meeting;
      return {
        itemKey: item.key,
        text:
          m === null
            ? `No call is booked with ${name} yet.`
            : m.booked
              ? `Yes, the call with ${name} is booked for ${when(m.startsAt)}. Capital Q doesn't track a separate accept click, so booked on both calendars is what I can confirm.`
              : `The call with ${name} isn't confirmed: it is ${m.status.toLowerCase()} (${when(m.startsAt)}).`,
      };
    }
  }
}
