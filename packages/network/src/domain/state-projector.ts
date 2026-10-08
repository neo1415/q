import type {
  DisclosureScope,
  RelationshipStateV1,
  RelationshipStateV2,
} from "@capital-q/contracts";

import {
  RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED,
  RELATIONSHIP_EVENT_COMMITMENT_DETECTED,
  RELATIONSHIP_EVENT_COMMITMENT_DISPUTED,
  RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
  RELATIONSHIP_EVENT_COMMITMENT_TRANSFER_SENT,
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
  RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
  RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  RELATIONSHIP_EVENT_DEAL_CLOSED,
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
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
 * relationship-state.v2 (below) adds the journey after the match.
 * A registered event that is not a legal move from the current state is
 * kept as an anomaly and changes nothing -- contradictions are surfaced,
 * never silently resolved. An event type v1 does not know is skipped and
 * counted, so a newer producer cannot corrupt an older reader.
 */

/**
 * Every projector version ever written, oldest first. Append-only: a
 * projection stored under an older version stays readable and can be
 * re-folded by its own rules (projectorFor).
 */
export const RELATIONSHIP_PROJECTOR_VERSIONS = [
  "relationship-state.v1",
  "relationship-state.v2",
] as const;
export type RelationshipProjectorVersion =
  (typeof RELATIONSHIP_PROJECTOR_VERSIONS)[number];

/** The version that folds new projections. */
export const RELATIONSHIP_PROJECTOR_VERSION =
  "relationship-state.v2" as const satisfies RelationshipProjectorVersion;

export type ProjectableEvent = {
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly visibilityScope: DisclosureScope;
  /** Read by v2 only, for a confirmed commitment's level. */
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
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
  // 2026-10-04: activity in v1; v2 reads a receipt as INVESTED.
  RELATIONSHIP_EVENT_COMMITMENT_TRANSFER_SENT,
  RELATIONSHIP_EVENT_COMMITMENT_RECEIVED,
]);

export type RelationshipProjection = {
  readonly version: RelationshipProjectorVersion;
  readonly state: RelationshipStateV2;
  /** When the relationship reached `state`: the moving event's occurredAt. */
  readonly stateSince: string;
  /** The last sequence folded. */
  readonly throughSequence: number;
  /** One entry per state reached, in order. */
  readonly milestones: readonly {
    readonly state: RelationshipStateV2;
    readonly at: string;
    readonly sequence: number;
  }[];
  /** Registered events that were not a legal move. Surfaced, never applied. */
  readonly anomalies: readonly {
    readonly sequence: number;
    readonly eventType: string;
    readonly from: RelationshipStateV2;
  }[];
  /** Events of a type this version does not read. */
  readonly unrecognised: number;
};

/**
 * relationship-state.v1's fold, kept as it was so a v1 projection can
 * always be reproduced. Input order and duplicates do not matter: events
 * are ordered by their sequence and a sequence is folded once. An empty
 * history has no projection.
 */
export function projectRelationshipStateV1(
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
    version: "relationship-state.v1",
    state,
    stateSince,
    throughSequence,
    milestones,
    anomalies,
    unrecognised,
  };
}

/**
 * relationship-state.v2 (founder request 2026-10-02): the journey after the
 * match. v1's moves are all still here; v2 adds
 *
 *   CONNECTED --meeting_held--> MEETING_HELD
 *   CONNECTED | MEETING_HELD --diligence_started--> IN_DILIGENCE
 *   CONNECTED | MEETING_HELD | IN_DILIGENCE --relationship_paused--> PAUSED
 *   CONNECTED | MEETING_HELD | IN_DILIGENCE | PAUSED --relationship_passed--> PASSED
 *   PAUSED | PASSED --relationship_resumed--> the state before the pause or pass
 *   CONNECTED | MEETING_HELD | IN_DILIGENCE | PAUSED
 *     --commitment_confirmed (level INVESTED)--> INVESTED
 *   INVESTED --commitment_withdrawn (that commitment)--> the state before
 *   CONNECTED | MEETING_HELD | IN_DILIGENCE | PAUSED
 *     --commitment_received (any level; 2026-10-04)--> INVESTED
 *
 * A meeting held after the first, a SOFT or FIRM confirmation, mail and
 * chat stay activity: they never move state and are never anomalies. A
 * relationship_progressed records a confirmed outcome in a live match and
 * moves nothing. Still no clock, no I/O, no model.
 */
export const RELATIONSHIP_STATE_TRANSITIONS_V2: Readonly<
  Record<RelationshipStateV2, Readonly<Record<string, RelationshipStateV2>>>
> = {
  ...RELATIONSHIP_STATE_TRANSITIONS,
  CONNECTED: {
    [RELATIONSHIP_EVENT_MEETING_HELD]: "MEETING_HELD",
    [RELATIONSHIP_EVENT_DILIGENCE_STARTED]: "IN_DILIGENCE",
    [RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED]: "PAUSED",
    [RELATIONSHIP_EVENT_RELATIONSHIP_PASSED]: "PASSED",
  },
  MEETING_HELD: {
    [RELATIONSHIP_EVENT_DILIGENCE_STARTED]: "IN_DILIGENCE",
    [RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED]: "PAUSED",
    [RELATIONSHIP_EVENT_RELATIONSHIP_PASSED]: "PASSED",
  },
  IN_DILIGENCE: {
    [RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED]: "PAUSED",
    [RELATIONSHIP_EVENT_RELATIONSHIP_PASSED]: "PASSED",
  },
  PAUSED: {
    [RELATIONSHIP_EVENT_RELATIONSHIP_PASSED]: "PASSED",
  },
  PASSED: {},
  INVESTED: {},
};

/** States a confirmed INVESTED commitment may move to INVESTED. */
const INVESTABLE: ReadonlySet<RelationshipStateV2> = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
]);

/** Restatements in v2: legal, and not a move. */
const RESTATEMENTS_V2: Readonly<
  Record<string, readonly RelationshipStateV2[]>
> = {
  [RELATIONSHIP_EVENT_DISCOVERED]: [
    "DISCOVERED",
    "INTEREST_EXPRESSED",
    "CONNECTED",
    "DECLINED",
    "MEETING_HELD",
    "IN_DILIGENCE",
    "PAUSED",
    "PASSED",
    "INVESTED",
  ],
  [RELATIONSHIP_EVENT_INTEREST_EXPRESSED]: ["INTEREST_EXPRESSED"],
  [RELATIONSHIP_EVENT_DILIGENCE_STARTED]: ["IN_DILIGENCE"],
  [RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED]: ["PAUSED"],
  [RELATIONSHIP_EVENT_RELATIONSHIP_PASSED]: ["PASSED"],
  [RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED]: [
    "CONNECTED",
    "MEETING_HELD",
    "IN_DILIGENCE",
  ],
};

/** v2's activity: v1's, plus diligence documents (never a move). */
const ACTIVITY_TYPES_V2: ReadonlySet<string> = new Set([
  ...ACTIVITY_TYPES,
  RELATIONSHIP_EVENT_DOCUMENT_REQUESTED,
  RELATIONSHIP_EVENT_DOCUMENT_SHARED,
  // Data room (overnight A3): a request and a grant are activity, never a
  // move; viewing or asking is not interest.
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_REQUESTED,
  RELATIONSHIP_EVENT_DATA_ROOM_ACCESS_GRANTED,
  // Deal close (2026-10-08): terms, signature and close are activity for
  // the relationship state -- the money's receipt already reads INVESTED.
  // deal-stage.v1 (deal-stage.ts) reads them as the stage strip.
  RELATIONSHIP_EVENT_DEAL_TERMS_RECORDED,
  RELATIONSHIP_EVENT_DEAL_TERMS_SIGNED,
  RELATIONSHIP_EVENT_DEAL_CLOSED,
]);

const KNOWN_TYPES_V2: ReadonlySet<string> = new Set([
  ...KNOWN_TYPES,
  RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED,
]);

function payloadString(
  event: ProjectableEvent,
  key: string,
): string | undefined {
  const value = event.payload?.[key];
  return typeof value === "string" ? value : undefined;
}

export function projectRelationshipStateV2(
  events: readonly ProjectableEvent[],
): RelationshipProjection | null {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  // One mutable record, moved only by `move`: where the relationship is,
  // where a pause or a pass returns to when lifted, and where a withdrawn
  // investment returns to.
  const at: {
    state: RelationshipStateV2;
    since: string | null;
    resumeTo: RelationshipStateV2 | null;
    investedBy: { commitmentId: string; from: RelationshipStateV2 } | null;
  } = { state: "DISCOVERED", since: null, resumeTo: null, investedBy: null };
  let throughSequence = 0;
  const milestones: {
    state: RelationshipStateV2;
    at: string;
    sequence: number;
  }[] = [];
  const anomalies: {
    sequence: number;
    eventType: string;
    from: RelationshipStateV2;
  }[] = [];
  let unrecognised = 0;

  const move = (next: RelationshipStateV2, event: ProjectableEvent) => {
    if (
      (next === "PAUSED" || next === "PASSED") &&
      at.state !== "PAUSED" &&
      at.state !== "PASSED"
    ) {
      at.resumeTo = at.state;
    }
    at.state = next;
    at.since = event.occurredAt;
    milestones.push({
      state: next,
      at: event.occurredAt,
      sequence: event.sequence,
    });
  };

  for (const event of ordered) {
    if (seen.has(event.sequence)) continue;
    seen.add(event.sequence);
    throughSequence = Math.max(throughSequence, event.sequence);
    at.since ??= event.occurredAt;

    if (event.eventType === RELATIONSHIP_EVENT_MEETING_HELD) {
      // The first meeting of a match moves it; every other is activity.
      if (at.state === "CONNECTED") move("MEETING_HELD", event);
      continue;
    }
    if (event.eventType === RELATIONSHIP_EVENT_COMMITMENT_RECEIVED) {
      // The company's side confirmed the money arrived: invested, whatever
      // level was said. A receipt is never withdrawn.
      const commitmentId = payloadString(event, "commitmentId");
      if (commitmentId !== undefined && INVESTABLE.has(at.state)) {
        at.investedBy = { commitmentId, from: at.state };
        move("INVESTED", event);
      }
      continue;
    }
    if (event.eventType === RELATIONSHIP_EVENT_COMMITMENT_CONFIRMED) {
      const commitmentId = payloadString(event, "commitmentId");
      if (
        payloadString(event, "level") === "INVESTED" &&
        commitmentId !== undefined &&
        INVESTABLE.has(at.state)
      ) {
        at.investedBy = { commitmentId, from: at.state };
        move("INVESTED", event);
      }
      continue;
    }
    if (event.eventType === RELATIONSHIP_EVENT_COMMITMENT_WITHDRAWN) {
      const commitmentId = payloadString(event, "commitmentId");
      if (
        at.state === "INVESTED" &&
        at.investedBy !== null &&
        commitmentId === at.investedBy.commitmentId
      ) {
        const back = at.investedBy.from;
        at.investedBy = null;
        move(back, event);
      }
      continue;
    }
    if (ACTIVITY_TYPES_V2.has(event.eventType)) continue;
    if (!KNOWN_TYPES_V2.has(event.eventType)) {
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
    if (event.eventType === RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED) {
      if (
        (at.state === "PAUSED" || at.state === "PASSED") &&
        at.resumeTo !== null
      ) {
        const back = at.resumeTo;
        at.resumeTo = null;
        move(back, event);
        continue;
      }
      anomalies.push({
        sequence: event.sequence,
        eventType: event.eventType,
        from: at.state,
      });
      continue;
    }
    const next: RelationshipStateV2 | undefined =
      RELATIONSHIP_STATE_TRANSITIONS_V2[at.state][event.eventType];
    if (next !== undefined) {
      move(next, event);
      continue;
    }
    if (RESTATEMENTS_V2[event.eventType]?.includes(at.state) === true) {
      continue;
    }
    anomalies.push({
      sequence: event.sequence,
      eventType: event.eventType,
      from: at.state,
    });
  }

  if (at.since === null) return null;
  return {
    version: "relationship-state.v2",
    state: at.state,
    stateSince: at.since,
    throughSequence,
    milestones,
    anomalies,
    unrecognised,
  };
}

/** The current fold. */
export const projectRelationshipState = projectRelationshipStateV2;

/** The fold a stored projection was made with, to reproduce or compare it. */
export function projectorFor(
  version: RelationshipProjectorVersion,
): (events: readonly ProjectableEvent[]) => RelationshipProjection | null {
  return version === "relationship-state.v1"
    ? projectRelationshipStateV1
    : projectRelationshipStateV2;
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
  | "DECIDE_NEXT_STEP"
  | "FOLLOW_UP"
  | "RESUME"
  | "NONE";

/** What is next for the party asking. A plain step, never a score. */
export function nextStepFor(
  state: RelationshipStateV2,
  party: RelationshipParty,
  /** Who sent the open interest; a founder's Connection Request is COMPANY. */
  expressedBy: RelationshipParty = "INVESTOR",
  /** Who paused, when PAUSED: only they resume. */
  pausedBy: RelationshipParty = "INVESTOR",
): RelationshipNextStep {
  switch (state) {
    case "DISCOVERED":
      return party === "INVESTOR" ? "EXPRESS_INTEREST" : "NONE";
    case "INTEREST_EXPRESSED":
      return party === expressedBy ? "AWAIT_ANSWER" : "ANSWER_INTEREST";
    case "CONNECTED":
      // Doc 17 §86: the post-match primary action.
      return "SCHEDULE_MEETING";
    case "MEETING_HELD":
      // After a call the investor decides (diligence, pass, pause) and
      // the founder follows up; another meeting is never the default.
      return party === "INVESTOR" ? "DECIDE_NEXT_STEP" : "FOLLOW_UP";
    case "IN_DILIGENCE":
      return party === "INVESTOR" ? "DECIDE_NEXT_STEP" : "FOLLOW_UP";
    case "PAUSED":
      return party === pausedBy ? "RESUME" : "NONE";
    case "DECLINED":
    case "PASSED":
    case "INVESTED":
      return "NONE";
  }
}
