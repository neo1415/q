import {
  WORKFORCE_SITUATION_MAX,
  type RelationshipBrief,
  type RelationshipBriefDecision,
  type WorkforceFactKind,
  type WorkforceNextAction,
  type WorkforceSituationFact,
} from "@capital-q/contracts";

/**
 * What the lead Q knows before it plans (wf 2026-10-16).
 *
 * Code turns reads already authorised as the person -- the Relationship
 * Brief of each record the goal names, and what waits for their approval
 * -- into numbered facts (`F1`..). The model reads them and may refer to
 * them; it never writes one. A source that could not be read is an UNKNOWN
 * fact ("not known right now"), never an empty history, and nothing absent
 * is turned into a negative.
 *
 * `moves` keeps, beside each whose-move fact, the decision it came from, so
 * code (never the model) can say what the next action would be and which
 * tool it would use.
 */

export type JobSituation = {
  readonly facts: readonly WorkforceSituationFact[];
  /** Whose-move facts and the decision each came from (code only). */
  readonly moves: readonly {
    readonly ref: string;
    readonly owner: "YOU" | "THEM";
    readonly kind: RelationshipBriefDecision["kind"];
    readonly counterparty: string;
  }[];
};

export const EMPTY_SITUATION: JobSituation = { facts: [], moves: [] };

const OPEN_REQUESTS_MAX = 3;
const WAITING_MAX = 3;
const MANDATE_MAX = 3;

function day(at: string): string {
  return at.slice(0, 10);
}

function words(code: string): string {
  return code.toLowerCase().replaceAll("_", " ");
}

const DECISION_WORDS: Readonly<
  Record<RelationshipBriefDecision["kind"], string>
> = {
  ANSWER_INTEREST: "answer their interest",
  AWAIT_ANSWER: "answer the interest expressed",
  EXPRESS_INTEREST: "express interest",
  REPLY_TO_MESSAGE: "reply to their message",
  SCHEDULE_MEETING: "set up a call",
  ATTEND_MEETING: "attend the booked call",
  DECIDE_NEXT_STEP: "decide the next step after the call",
  FOLLOW_UP: "follow up",
  RESUME: "resume the paused conversation",
};

/**
 * The person's relationships at a glance, when the goal names nobody (a
 * founder preparing a round): their own side's list, folded by the
 * Network context. Structural, so this package needs no tool types.
 */
export type RelationshipOverview = {
  readonly items: readonly {
    readonly name: string;
    readonly state: string;
    readonly stateSince: string;
    readonly nextStep: string;
    /** Who wrote last; undefined or null: not known or no messages. */
    readonly lastFrom?: "THEM" | "YOU" | null | undefined;
    readonly lastAt?: string | null | undefined;
  }[];
};

const OVERVIEW_ITEMS_MAX = 6;

export function situationFrom(input: {
  readonly briefs: readonly RelationshipBrief[];
  /** Read only when the goal names no relationship of theirs. */
  readonly overview?: RelationshipOverview | null | undefined;
  /** Briefs that were asked for and could not be read: names, or null. */
  readonly unreadable?: readonly (string | null)[] | undefined;
  readonly waiting?: readonly { readonly summary: string }[] | undefined;
  /**
   * Their declared mandate and thesis lines, read as them (an investor's
   * situation dossier, MANDATE section). Null: could not be read
   * (UNKNOWN); absent or empty: none on record or not theirs to have.
   */
  readonly mandate?: readonly string[] | null | undefined;
}): JobSituation {
  const facts: WorkforceSituationFact[] = [];
  const moves: {
    ref: string;
    owner: "YOU" | "THEM";
    kind: RelationshipBriefDecision["kind"];
    counterparty: string;
  }[] = [];
  const add = (
    kind: WorkforceFactKind,
    text: string,
    at: string | null = null,
  ): string | null => {
    if (facts.length >= WORKFORCE_SITUATION_MAX) return null;
    const ref = `F${String(facts.length + 1)}`;
    facts.push({ ref, kind, text: text.slice(0, 300), at });
    return ref;
  };

  // First: what every investment question is weighed against.
  if (input.mandate === null) {
    add("UNKNOWN", "Your declared mandate and thesis: not known right now.");
  } else {
    for (const line of (input.mandate ?? []).slice(0, MANDATE_MAX)) {
      add("MANDATE", line);
    }
  }

  for (const brief of input.briefs) {
    const name = brief.counterparty.name ?? "the other side";
    if (brief.state === null) {
      add("RELATIONSHIP_STATE", `Nothing on record with ${name} yet.`);
    } else {
      add(
        "RELATIONSHIP_STATE",
        `With ${name}: ${words(brief.state.state)} since ${day(brief.state.stateSince)}.`,
        brief.state.stateSince,
      );
    }
    for (const decision of brief.pendingDecisions.items) {
      const ref = add(
        decision.owner === "YOU" ? "YOUR_MOVE" : "THEIR_MOVE",
        decision.owner === "YOU"
          ? `Your move with ${name}: ${DECISION_WORDS[decision.kind]}.`
          : `Waiting on ${name} to ${DECISION_WORDS[decision.kind]}.`,
        decision.since,
      );
      if (ref !== null) {
        moves.push({
          ref,
          owner: decision.owner,
          kind: decision.kind,
          counterparty: name,
        });
      }
    }
    if (!brief.pendingDecisions.complete) {
      add("UNKNOWN", `Part of what is pending with ${name} could not be read.`);
    }
    const latest = brief.messages.latest;
    if (latest.status === "UNAVAILABLE") {
      add("UNKNOWN", `Messages with ${name}: not known right now.`);
    } else if (latest.message?.from === "OTHER_SIDE") {
      add(
        "MESSAGE_WAITING",
        `${name} wrote last, on ${day(latest.message.sentAt)}; ${String(brief.messages.count)} messages on the thread.`,
        latest.message.sentAt,
      );
    }
    const meetings = brief.meetings;
    if (meetings.status === "UNAVAILABLE") {
      add("UNKNOWN", `Calls with ${name}: not known right now.`);
    } else {
      if (meetings.nextScheduled !== null) {
        add(
          "MEETING_UPCOMING",
          `Call with ${name} booked for ${day(meetings.nextScheduled.startsAt)}.`,
          meetings.nextScheduled.startsAt,
        );
      }
      const past = meetings.items
        .filter((one) => one.timing === "PAST" && one.status === "SCHEDULED")
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
      if (past !== undefined) {
        add(
          "MEETING_PAST",
          `Last call with ${name} was on ${day(past.startsAt)}.`,
          past.startsAt,
        );
      }
    }
    for (const noShow of brief.noShows.slice(0, 2)) {
      add(
        "NO_SHOW",
        `A call with ${name} did not take place (${day(noShow.at)}).`,
        noShow.at,
      );
    }
    const obligations = brief.obligations;
    if (obligations.status === "UNAVAILABLE") {
      add("UNKNOWN", `Diligence requests with ${name}: not known right now.`);
    } else {
      for (const request of obligations.openRequests.slice(
        0,
        OPEN_REQUESTS_MAX,
      )) {
        add(
          "OPEN_REQUEST",
          `Open diligence request with ${name}: ${request.title}.`,
        );
      }
      const more = obligations.openRequests.length - OPEN_REQUESTS_MAX;
      if (more > 0) {
        add(
          "OPEN_REQUEST",
          `${String(more)} more open diligence requests with ${name}.`,
        );
      }
      if (obligations.answeredCount > 0) {
        add(
          "OPEN_REQUEST",
          `${String(obligations.answeredCount)} diligence requests with ${name} already answered.`,
        );
      }
    }
    const documents = brief.documents;
    if (documents.status === "UNAVAILABLE") {
      add("UNKNOWN", `Documents shared with ${name}: not known right now.`);
    } else if (documents.items.length > 0) {
      const titles = documents.items
        .slice(0, 3)
        .map((one) => one.title.slice(0, 60))
        .join("; ");
      add(
        "DOCUMENT_SHARED",
        `${String(documents.items.length)} documents shared with ${name}: ${titles}.`,
      );
    }
  }
  if (input.overview === null) {
    add("UNKNOWN", "Your relationships: not known right now.");
  } else if (input.overview !== undefined) {
    const items = input.overview.items;
    const byState = new Map<string, number>();
    for (const item of items) {
      byState.set(item.state, (byState.get(item.state) ?? 0) + 1);
    }
    add(
      "RELATIONSHIP_STATE",
      items.length === 0
        ? "No relationships on record yet."
        : `Your ${String(items.length)} relationships: ${[...byState.entries()]
            .map(([state, count]) => `${String(count)} ${words(state)}`)
            .join(", ")}.`,
    );
    const recent = [...items]
      .sort((a, b) => b.stateSince.localeCompare(a.stateSince))
      .slice(0, OVERVIEW_ITEMS_MAX);
    for (const item of recent) {
      const name = item.name.slice(0, 120);
      add(
        "RELATIONSHIP_STATE",
        `With ${name}: ${words(item.state)} since ${day(item.stateSince)}; next step: ${words(item.nextStep)}.`,
        item.stateSince,
      );
      if (item.lastFrom === "THEM") {
        const ref = add(
          "MESSAGE_WAITING",
          `${name} wrote last${item.lastAt == null ? "" : `, on ${day(item.lastAt)}`}; not answered yet.`,
          item.lastAt ?? null,
        );
        if (ref !== null) {
          moves.push({
            ref,
            owner: "YOU",
            kind: "REPLY_TO_MESSAGE",
            counterparty: name,
          });
        }
      }
    }
  }
  for (const name of input.unreadable ?? []) {
    add(
      "UNKNOWN",
      `Where things stand with ${name ?? "a record the job names"}: not known right now.`,
    );
  }
  for (const item of (input.waiting ?? []).slice(0, WAITING_MAX)) {
    add(
      "WAITING_APPROVAL",
      `Waiting for your approval: ${item.summary.slice(0, 200)}`,
    );
  }
  return { facts, moves };
}

/** The situation as the lead's prompt reads it. */
export function situationText(situation: JobSituation): string {
  if (situation.facts.length === 0) {
    return "Nothing on record was read for this job: the goal names no record of theirs.";
  }
  return situation.facts
    .map((fact) => `${fact.ref} [${fact.kind}] ${fact.text}`)
    .join("\n");
}

/**
 * The tool the person's own move would use, when Q could prepare it.
 * Null: only the person can do it (attend a call, decide).
 */
const MOVE_TOOL: Readonly<
  Record<RelationshipBriefDecision["kind"], string | null>
> = {
  ANSWER_INTEREST: "relationship.interest.respond",
  AWAIT_ANSWER: "relationship.interest.respond",
  EXPRESS_INTEREST: "relationship.interest.express",
  REPLY_TO_MESSAGE: "chat.message.send",
  SCHEDULE_MEETING: "schedule.meeting.book",
  ATTEND_MEETING: null,
  DECIDE_NEXT_STEP: null,
  FOLLOW_UP: "chat.message.send",
  RESUME: "chat.message.send",
};

/**
 * Tools Q may use without asking (reads). Anything else Q would do is
 * consequential and needs the person's approval of the exact payload.
 */
export const READ_ONLY_JOB_TOOLS: ReadonlySet<string> = new Set([
  "search_companies",
  "list_my_relationships",
  "list_messages",
  "find_meeting_times",
  "list_schedule",
  "public_web.search",
]);

/** Code, never a model: whether Q doing this needs the person's approval. */
export function needsApproval(tool: string | null): boolean {
  return tool !== null && !READ_ONLY_JOB_TOOLS.has(tool);
}

/** The person's own moves, as next actions with the fact behind each. */
export function movesAsNextActions(
  situation: JobSituation,
): readonly WorkforceNextAction[] {
  return situation.moves
    .filter((move) => move.owner === "YOU")
    .map((move) => {
      const tool = MOVE_TOOL[move.kind];
      const action = `${DECISION_WORDS[move.kind].charAt(0).toUpperCase()}${DECISION_WORDS[move.kind].slice(1)} with ${move.counterparty}`;
      return {
        action: action.slice(0, 300),
        why: "It is your move on the relationship.",
        evidence: [move.ref],
        tool,
        needsApproval: needsApproval(tool),
        source: "SITUATION" as const,
      };
    });
}
