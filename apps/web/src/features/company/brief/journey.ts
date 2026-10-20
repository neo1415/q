import type { MeetingDto, RelationshipStateV2 } from "@capital-q/contracts";

/**
 * The next-step ribbon's journey (profile option 1, owner 2026-10-20): one
 * next action with its reason, and marks for where the investor is.
 *
 * Built only from what this reader already has: the relationship's state,
 * the questions Q drafted from the gaps this investor can see (and whether
 * they were asked), the documents listed to them on request, and their own
 * calls. Each step's action is an existing flow with its own approval;
 * nothing here sends anything. Pure, so it is tested without a screen.
 */

export type JourneyKind = "CONNECT" | "ASK" | "DOCUMENTS" | "CALL" | "DECIDE";
export type JourneyMark = "DONE" | "NOW" | "LATER";

export type JourneyStep = {
  readonly kind: JourneyKind;
  readonly mark: JourneyMark;
  readonly title: string;
  readonly reason: string;
  /** The primary button's words; null: nothing to press yet. */
  readonly action: string | null;
  /** The phone dock's shorter words for the same button. */
  readonly short: string | null;
};

export type JourneyInput = {
  readonly companyName: string;
  /** Who the questions go to (the first founder named); null: the company. */
  readonly founderName: string | null;
  readonly state: RelationshipStateV2 | null;
  /** Matched (the founders accepted): questions and requests can be sent. */
  readonly connected: boolean;
  /** Drafted, not yet sent, with what each is about. */
  readonly drafts: readonly { readonly topic: string }[];
  /** Asked and still waiting for an answer. */
  readonly waiting: number;
  /** Titles of documents listed to them on request, not yet asked for. */
  readonly requestable: readonly string[];
  /** Asked for and waiting on the founders. */
  readonly requested: number;
  /** Their next scheduled call, if any. */
  readonly nextCall: {
    readonly startsAt: string;
    readonly timeZone: string;
    readonly hasBrief: boolean;
  } | null;
  /** A call already took place (a milestone of the relationship). */
  readonly met: boolean;
};

const CLOSED: readonly RelationshipStateV2[] = [
  "DECLINED",
  "PASSED",
  "INVESTED",
];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function list(items: readonly string[]): string {
  const shown = items.slice(0, 3).map((item) => item.toLowerCase());
  const rest = items.length - shown.length;
  if (shown.length === 0) return "";
  if (rest > 0)
    return `${shown.join(", ")} and ${plural(rest, "more", "more")}`;
  if (shown.length === 1) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
}

/** "21 Oct, 14:00" in the call's own time zone. */
export function callMoment(startsAt: string, timeZone: string): string {
  const at = new Date(startsAt);
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone });
      return timeZone;
    } catch {
      return "UTC";
    }
  })();
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: zone,
  }).format(at);
  return `${day}, ${time}`;
}

/**
 * The steps in order, each marked, and the index of the one to do now.
 * Null when there is no next step to offer (a closed relationship).
 */
export function journeyFor(
  input: JourneyInput,
): { readonly steps: readonly JourneyStep[]; readonly now: number } | null {
  const { companyName: name, state } = input;
  if (state !== null && CLOSED.includes(state)) return null;
  const who = input.founderName ?? name;
  const steps: JourneyStep[] = [];

  if (!input.connected) {
    const pending = state === "INTEREST_EXPRESSED";
    steps.push({
      kind: "CONNECT",
      mark: "NOW",
      title: pending
        ? `Wait for ${name} to accept your interest`
        : `Express interest in ${name}`,
      reason: pending
        ? "Questions, documents and calls open once they accept. The founders were told when you sent it."
        : "Once the founders accept, you can send questions, request documents and book a call.",
      action: pending ? null : "Express interest",
      short: pending ? null : "Interest",
    });
  }

  const drafts = input.drafts.length;
  const askDone = drafts === 0;
  steps.push({
    kind: "ASK",
    mark: askDone ? "DONE" : "LATER",
    title:
      drafts === 0
        ? input.waiting > 0
          ? `Wait for ${who} to answer ${plural(input.waiting, "question")}`
          : `No open questions for ${who}`
        : `Send ${plural(drafts, "question")} to ${who}`,
    reason:
      drafts === 0
        ? "Q adds a question here when it finds a gap the deck doesn't cover."
        : `They close the gaps Q found: ${list(input.drafts.map((d) => d.topic))}.`,
    action: drafts === 0 ? null : "Send questions",
    short: drafts === 0 ? null : "Send",
  });

  const docs = input.requestable.length;
  steps.push({
    kind: "DOCUMENTS",
    mark: docs === 0 ? "DONE" : "LATER",
    title:
      docs === 0
        ? input.requested > 0
          ? `Wait for ${name} to answer your document requests`
          : "Nothing in the data room left to request"
        : docs === 1
          ? `Request ${input.requestable[0] ?? "the document on request"}`
          : `Request the ${String(docs)} documents on request`,
    reason:
      docs === 0
        ? "Documents listed to you on request appear here."
        : `${list(input.requestable)} ${docs === 1 ? "is" : "are"} on request. Q needs them to check what the deck claims; ${name} decides who sees them.`,
    action:
      docs === 0
        ? null
        : docs === 1
          ? "Request it"
          : `Request ${String(docs)} documents`,
    short: docs === 0 ? null : "Request",
  });

  const call = input.nextCall;
  steps.push({
    kind: "CALL",
    mark: input.met && call === null ? "DONE" : "LATER",
    title:
      call !== null
        ? `Prepare for your call on ${callMoment(call.startsAt, call.timeZone)}`
        : input.met
          ? `You've met ${name}`
          : `Book a call with ${name}`,
    reason:
      call !== null
        ? call.hasBrief
          ? "Q drafted a call brief from the deck, your questions and the documents you’ve opened."
          : "Q prepares a brief from the deck, your questions and the documents you’ve opened."
        : "Q finds times that suit you both. Nothing is sent until you approve it.",
    action:
      call !== null ? "Open call brief" : input.met ? null : "Find a time",
    short: call !== null ? "Brief" : input.met ? null : "Book",
  });

  steps.push({
    kind: "DECIDE",
    mark: "LATER",
    title: "Record a soft commitment after the call",
    reason: `Say what you’d put in. ${name} confirms it. It isn’t binding, and you can withdraw it.`,
    action: "Record commitment",
    short: "Record",
  });

  // Before the founders accept, nothing after CONNECT can be done yet.
  const now = input.connected
    ? Math.max(
        0,
        steps.findIndex((step) => step.mark !== "DONE"),
      )
    : 0;
  return {
    steps: steps.map((step, index) =>
      index === now
        ? { ...step, mark: "NOW" }
        : !input.connected && index > 0
          ? { ...step, mark: "LATER" }
          : step,
    ),
    now,
  };
}

// Plain (no "use client"): the profile page, a server component, reads it.
export type NextCall = Pick<MeetingDto, "startsAt" | "timeZone" | "hasBrief">;

/** The reader's next scheduled call, from their own meetings read. */
export function nextCallOf(
  meetings: readonly MeetingDto[] | null,
  now: number = Date.now(),
): NextCall | null {
  const next = (meetings ?? [])
    .filter(
      (meeting) =>
        meeting.status === "SCHEDULED" && Date.parse(meeting.endsAt) > now,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return next === undefined
    ? null
    : {
        startsAt: next.startsAt,
        timeZone: next.timeZone,
        hasBrief: next.hasBrief,
      };
}
