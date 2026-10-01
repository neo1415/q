import type {
  DisclosureScope,
  RelationshipStateV1,
} from "@capital-q/contracts";

import {
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  RELATIONSHIP_EVENT_COMMITMENT_STATED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  RELATIONSHIP_EVENT_DISCOVERED,
  RELATIONSHIP_EVENT_INTEREST_DECLINED,
  RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
  RELATIONSHIP_EVENT_OUTREACH_SENT,
  RELATIONSHIP_EVENT_REPLY_RECEIVED,
  RELATIONSHIP_EVENT_MEETING_CANCELLED,
  RELATIONSHIP_EVENT_MEETING_HELD,
  RELATIONSHIP_EVENT_MEETING_NO_SHOW,
  RELATIONSHIP_EVENT_MEETING_RECORDING_DECLINED,
  RELATIONSHIP_EVENT_MEETING_RESCHEDULED,
  RELATIONSHIP_EVENT_MEETING_SCHEDULED,
  RELATIONSHIP_EVENT_MESSAGE_SENT,
} from "./event-registry.js";

/**
 * The relationship state projector, relationship-state.v1 (CQ-NET-012;
 * doc 25 §120, doc 13 §28.3).
 *
 * A pure, deterministic fold of a relationship's ordered history into
 * where the relationship is now. No clock, no I/O, no model: the same
 * history always yields the same answer, whatever order it was delivered
 * in and however often. The history is the authority; this is only ever a
 * reading of it, and a later version may read it differently -- which is
 * why the version travels with every projection it makes.
 *
 *   DISCOVERED --interest_expressed--> INTEREST_EXPRESSED
 *   INTEREST_EXPRESSED --connection_accepted--> CONNECTED
 *   INTEREST_EXPRESSED --interest_declined--> DECLINED
 *   DECLINED --interest_expressed--> INTEREST_EXPRESSED
 *
 * CONNECTED has no way out in v1: ending a connection is not a v1 event.
 * A registered event that is not a legal move from the current state is
 * kept as an anomaly and changes nothing -- contradictions are surfaced,
 * never silently resolved. An event type v1 does not know is skipped and
 * counted, so a newer producer cannot corrupt an older reader.
 */

export const RELATIONSHIP_PROJECTOR_VERSION = "relationship-state.v1" as const;

export type ProjectableEvent = {
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly visibilityScope: DisclosureScope;
};

/** Every legal move, and nothing else. Exported so tests can hold the fold to it. */
export const RELATIONSHIP_STATE_TRANSITIONS: Readonly<
  Record<RelationshipStateV1, Readonly<Record<string, RelationshipStateV1>>>
> = {
  DISCOVERED: {
    [RELATIONSHIP_EVENT_INTEREST_EXPRESSED]: "INTEREST_EXPRESSED",
  },
  INTEREST_EXPRESSED: {
    [RELATIONSHIP_EVENT_CONNECTION_ACCEPTED]: "CONNECTED",
    [RELATIONSHIP_EVENT_INTEREST_DECLINED]: "DECLINED",
  },
  DECLINED: {
    [RELATIONSHIP_EVENT_INTEREST_EXPRESSED]: "INTEREST_EXPRESSED",
  },
  CONNECTED: {},
};

/** Events that restate where the relationship already is. Not anomalies. */
const RESTATEMENTS: Readonly<Record<string, readonly RelationshipStateV1[]>> = {
  [RELATIONSHIP_EVENT_DISCOVERED]: [
    "DISCOVERED",
    "INTEREST_EXPRESSED",
    "CONNECTED",
    "DECLINED",
  ],
  [RELATIONSHIP_EVENT_INTEREST_EXPRESSED]: ["INTEREST_EXPRESSED"],
};

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  RELATIONSHIP_EVENT_DISCOVERED,
  RELATIONSHIP_EVENT_INTEREST_EXPRESSED,
  RELATIONSHIP_EVENT_CONNECTION_ACCEPTED,
  RELATIONSHIP_EVENT_INTEREST_DECLINED,
]);

/** Registered activity that never moves state and is not an anomaly. */
const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  RELATIONSHIP_EVENT_OUTREACH_SENT,
  RELATIONSHIP_EVENT_REPLY_RECEIVED,
  RELATIONSHIP_EVENT_MESSAGE_SENT,
  RELATIONSHIP_EVENT_MEETING_SCHEDULED,
  RELATIONSHIP_EVENT_MEETING_RESCHEDULED,
  RELATIONSHIP_EVENT_MEETING_CANCELLED,
  RELATIONSHIP_EVENT_MEETING_HELD,
  RELATIONSHIP_EVENT_COMMITMENT_STATED,
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN,
  RELATIONSHIP_EVENT_MEETING_RECORDING_DECLINED,
  RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  RELATIONSHIP_EVENT_MEETING_NO_SHOW,
]);

export type RelationshipProjection = {
  readonly version: typeof RELATIONSHIP_PROJECTOR_VERSION;
  readonly state: RelationshipStateV1;
  /** When the relationship reached `state`: the moving event's occurredAt. */
  readonly stateSince: string;
  /** The last sequence folded. */
  readonly throughSequence: number;
  /** One entry per state reached, in order. */
  readonly milestones: readonly {
    readonly state: RelationshipStateV1;
    readonly at: string;
    readonly sequence: number;
  }[];
  /** Registered events that were not a legal move. Surfaced, never applied. */
  readonly anomalies: readonly {
    readonly sequence: number;
    readonly eventType: string;
    readonly from: RelationshipStateV1;
  }[];
  /** Events of a type this version does not read. */
  readonly unrecognised: number;
};

/**
 * Fold a history. Input order and duplicates do not matter: events are
 * ordered by their sequence and a sequence is folded once. An empty
 * history has no projection.
 */
export function projectRelationshipState(
  events: readonly ProjectableEvent[],
): RelationshipProjection | null {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  let state: RelationshipStateV1 = "DISCOVERED";
  let stateSince: string | null = null;
  let throughSequence = 0;
  const milestones: {
    state: RelationshipStateV1;
    at: string;
    sequence: number;
  }[] = [];
  const anomalies: {
    sequence: number;
    eventType: string;
    from: RelationshipStateV1;
  }[] = [];
  let unrecognised = 0;

  for (const event of ordered) {
    if (seen.has(event.sequence)) continue;
    seen.add(event.sequence);
    throughSequence = Math.max(throughSequence, event.sequence);
    stateSince ??= event.occurredAt;

    // Mail on the relationship (BIZ-007) is activity, never a state move.
    if (ACTIVITY_TYPES.has(event.eventType)) continue;
    if (!KNOWN_TYPES.has(event.eventType)) {
      unrecognised += 1;
      continue;
    }
    if (
      event.eventType === RELATIONSHIP_EVENT_DISCOVERED &&
      milestones.length === 0
    ) {
      milestones.push({
        state: "DISCOVERED",
        at: event.occurredAt,
        sequence: event.sequence,
      });
      continue;
    }
    const next: RelationshipStateV1 | undefined =
      RELATIONSHIP_STATE_TRANSITIONS[state][event.eventType];
    if (next !== undefined) {
      state = next;
      stateSince = event.occurredAt;
      milestones.push({
        state: next,
        at: event.occurredAt,
        sequence: event.sequence,
      });
      continue;
    }
    if (RESTATEMENTS[event.eventType]?.includes(state) === true) continue;
    anomalies.push({
      sequence: event.sequence,
      eventType: event.eventType,
      from: state,
    });
  }

  if (stateSince === null) return null;
  return {
    version: RELATIONSHIP_PROJECTOR_VERSION,
    state,
    stateSince,
    throughSequence,
    milestones,
    anomalies,
    unrecognised,
  };
}

/** Which side of the relationship is asking. */
export type RelationshipParty = "INVESTOR" | "COMPANY";

/**
 * The scopes a party may read in the history. A company never sees an
 * investor's private discovery, and an investor never sees a founder's
 * private note; organisation-, person- and specifically-scoped events
 * need a disclosure decision this reader does not make, so neither party
 * gets them here.
 */
const VISIBLE_SCOPES: Readonly<
  Record<RelationshipParty, ReadonlySet<DisclosureScope>>
> = {
  INVESTOR: new Set([
    "investor_private",
    "relationship_shared",
    "network_visible",
    "public_external",
  ]),
  COMPANY: new Set([
    "founder_private",
    "relationship_shared",
    "network_visible",
    "public_external",
  ]),
};

export function visibleToParty(
  events: readonly ProjectableEvent[],
  party: RelationshipParty,
): readonly ProjectableEvent[] {
  return events.filter((event) =>
    VISIBLE_SCOPES[party].has(event.visibilityScope),
  );
}

export type RelationshipNextStep =
  | "EXPRESS_INTEREST"
  | "AWAIT_ANSWER"
  | "ANSWER_INTEREST"
  | "SCHEDULE_MEETING"
  | "NONE";

/** What is next for the party asking. A plain step, never a score. */
export function nextStepFor(
  state: RelationshipStateV1,
  party: RelationshipParty,
  /** Who sent the open interest; a founder's Connection Request is COMPANY. */
  expressedBy: RelationshipParty = "INVESTOR",
): RelationshipNextStep {
  switch (state) {
    case "DISCOVERED":
      return party === "INVESTOR" ? "EXPRESS_INTEREST" : "NONE";
    case "INTEREST_EXPRESSED":
      return party === expressedBy ? "AWAIT_ANSWER" : "ANSWER_INTEREST";
    case "CONNECTED":
      // Doc 17 §86: the post-match primary action.
      return "SCHEDULE_MEETING";
    case "DECLINED":
      return "NONE";
  }
}
