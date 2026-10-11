import { randomUUID } from "node:crypto";

/**
 * Meeting time proposals (live bug 2026-10-09). A time is a proposal until
 * the investor, or a party authorised for them, explicitly accepts it:
 *
 *   PROPOSED -> INVESTOR_REVIEW -> CONFIRMED | DECLINED | COUNTERPROPOSED
 *   COUNTERPROPOSED -> CONFIRMED (founder accepts the counter)
 *                    | DECLINED (founder declines it)
 *                    | PROPOSED  (founder proposes new options)
 *
 * Nothing is booked, and nothing is announced as confirmed, before the
 * acceptance is recorded with its idempotency key. Q may facilitate in
 * conversation (suggest, compare, draft options) -- harmless, no prompt --
 * but only a recorded acceptance by an authorised human binds. The side of
 * an actor is derived from membership by the `parties` port, never taken
 * from the request. A reschedule is the same negotiation with
 * `rescheduleOfMeetingId`: the existing meeting stays valid until the
 * replacement is CONFIRMED.
 */

export type ProposalState =
  | "PROPOSED"
  | "INVESTOR_REVIEW"
  | "CONFIRMED"
  | "DECLINED"
  | "COUNTERPROPOSED";

export type ProposalSide = "FOUNDER" | "INVESTOR";
export type ProposalRole = ProposalSide | "SYSTEM";

export type ProposalAction =
  | "SEND_FOR_REVIEW"
  | "ACCEPT"
  | "DECLINE"
  | "COUNTER"
  | "ACCEPT_COUNTER"
  | "DECLINE_COUNTER"
  | "REPROPOSE";

type Rule = {
  readonly role: ProposalRole;
  readonly to: ProposalState;
  readonly event:
    | "SENT_FOR_REVIEW"
    | "ACCEPTED"
    | "DECLINED"
    | "COUNTERPROPOSED"
    | "COUNTER_ACCEPTED"
    | "COUNTER_DECLINED"
    | "REPROPOSED";
};

/** The whole machine: state -> action -> who may do it, and where it goes. */
export const PROPOSAL_TRANSITIONS: Readonly<
  Partial<
    Record<ProposalState, Partial<Record<ProposalAction, Rule>>>
  >
> = {
  PROPOSED: {
    SEND_FOR_REVIEW: {
      role: "SYSTEM",
      to: "INVESTOR_REVIEW",
      event: "SENT_FOR_REVIEW",
    },
  },
  INVESTOR_REVIEW: {
    ACCEPT: { role: "INVESTOR", to: "CONFIRMED", event: "ACCEPTED" },
    DECLINE: { role: "INVESTOR", to: "DECLINED", event: "DECLINED" },
    COUNTER: {
      role: "INVESTOR",
      to: "COUNTERPROPOSED",
      event: "COUNTERPROPOSED",
    },
  },
  COUNTERPROPOSED: {
    ACCEPT_COUNTER: {
      role: "FOUNDER",
      to: "CONFIRMED",
      event: "COUNTER_ACCEPTED",
    },
    DECLINE_COUNTER: {
      role: "FOUNDER",
      to: "DECLINED",
      event: "COUNTER_DECLINED",
    },
    REPROPOSE: { role: "FOUNDER", to: "PROPOSED", event: "REPROPOSED" },
  },
};

export type TransitionResult =
  | { readonly ok: true; readonly rule: Rule }
  | {
      readonly ok: false;
      readonly reason: "INVALID_STATE" | "ROLE_NOT_ALLOWED";
    };

export function transition(
  state: ProposalState,
  role: ProposalRole,
  action: ProposalAction,
): TransitionResult {
  const rule = PROPOSAL_TRANSITIONS[state]?.[action];
  if (rule === undefined) return { ok: false, reason: "INVALID_STATE" };
  if (rule.role !== role) return { ok: false, reason: "ROLE_NOT_ALLOWED" };
  return { ok: true, rule };
}

export type TimeOption = {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
};

export type ProposalRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly relationshipId: string;
  readonly purpose: string;
  readonly proposedByUserId: string;
  readonly state: ProposalState;
  readonly options: readonly TimeOption[];
  readonly counterOptions: readonly TimeOption[] | null;
  readonly acceptedFrom: "OPTIONS" | "COUNTER_OPTIONS" | null;
  readonly acceptedOption: number | null;
  readonly acceptedByUserId: string | null;
  readonly acceptedAt: Date | null;
  readonly rescheduleOfMeetingId: string | null;
  readonly meetingId: string | null;
  readonly revision: number;
  readonly idempotencyKey: string;
};

export type ProposalEvent = {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly eventType: Rule["event"] | "PROPOSED";
  readonly fromState: ProposalState | null;
  readonly toState: ProposalState;
  readonly actorUserId: string | null;
  readonly actorSide: ProposalSide | null;
  readonly optionIndex: number | null;
  readonly idempotencyKey: string;
};

/** What the store changes with a transition, applied only if the state still matches. */
export type ProposalPatch = {
  readonly options?: readonly TimeOption[];
  readonly counterOptions?: readonly TimeOption[] | null;
  readonly accepted?: {
    readonly from: "OPTIONS" | "COUNTER_OPTIONS";
    readonly option: number;
    readonly byUserId: string;
    readonly at: Date;
  };
  readonly revisionIncrement?: boolean;
};

export type ProposalStore = {
  readonly find: (id: string) => Promise<ProposalRecord | null>;
  readonly findEvent: (
    proposalId: string,
    idempotencyKey: string,
  ) => Promise<ProposalEvent | null>;
  readonly findByKey: (
    relationshipId: string,
    idempotencyKey: string,
  ) => Promise<ProposalRecord | null>;
  readonly listForRelationship: (
    relationshipId: string,
    limit: number,
  ) => Promise<readonly ProposalRecord[]>;
  /** Inserts the proposal and its first event together. */
  readonly create: (
    record: ProposalRecord,
    event: ProposalEvent,
  ) => Promise<void>;
  /**
   * Moves a proposal and appends the event together, only if it is still in
   * `expected` (and unrecorded under this key). False: someone else moved it.
   */
  readonly apply: (input: {
    readonly id: string;
    readonly expected: ProposalState;
    readonly patch: ProposalPatch;
    readonly event: ProposalEvent;
  }) => Promise<boolean>;
  readonly attachMeeting: (id: string, meetingId: string) => Promise<void>;
};

/**
 * Who the actor is on this relationship, derived by the server from their
 * active membership: FOUNDER (the company side) or INVESTOR. `binds` is
 * whether they may bind their side to a time (an active member with the
 * authority, or a delegate); null: not a party at all.
 */
export type ProposalParties = (input: {
  readonly actorUserId: string;
  readonly relationshipId: string;
}) => Promise<{
  readonly tenantId: string;
  readonly side: ProposalSide;
  readonly binds: boolean;
} | null>;

/**
 * Books the accepted time through the existing schedule path (the
 * organiser's own calendar, invites to the other side, `meeting_scheduled`
 * or `meeting_rescheduled` on the relationship). Idempotent by the key.
 * Never called before the acceptance is recorded.
 */
export type ProposalBooking = (input: {
  readonly proposal: ProposalRecord;
  readonly option: TimeOption;
  readonly idempotencyKey: string;
}) => Promise<{ readonly meetingId: string } | null>;

export type ProposalRefusal =
  | "NOT_A_PARTY"
  | "NOT_AUTHORISED"
  | "ROLE_NOT_ALLOWED"
  | "INVALID_STATE"
  | "INVALID_OPTIONS"
  | "INVALID_OPTION_INDEX"
  | "NOT_FOUND"
  | "TOO_MANY_REVISIONS"
  | "CONFLICT";

export type ProposalOutcome =
  | {
      readonly outcome: "OK";
      readonly proposal: ProposalRecord;
      /** True when this call recorded the transition; false: a replay. */
      readonly recorded: boolean;
      /**
       * True only when the acceptance is recorded: the one moment it is
       * true to tell anyone the time is confirmed. `booked` is whether the
       * calendar booking followed (it is retried, idempotently, if not).
       */
      readonly confirmed: boolean;
      readonly booked: boolean;
    }
  | { readonly outcome: "REFUSED"; readonly reason: ProposalRefusal };

const MAX_REVISIONS = 20;
const MAX_HORIZON_MS = 365 * 24 * 3_600_000;

export type ProposalServiceDependencies = {
  readonly store: ProposalStore;
  readonly parties: ProposalParties;
  readonly book: ProposalBooking;
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly logger?: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
};

export type ProposeInput = {
  readonly actorUserId: string;
  readonly relationshipId: string;
  readonly purpose: string;
  readonly options: readonly TimeOption[];
  readonly rescheduleOfMeetingId?: string | null;
  readonly idempotencyKey: string;
};

export type RespondInput = {
  readonly actorUserId: string;
  readonly proposalId: string;
  readonly action: Exclude<ProposalAction, "SEND_FOR_REVIEW">;
  readonly optionIndex?: number;
  readonly options?: readonly TimeOption[];
  readonly idempotencyKey: string;
};

export type ProposalService = {
  /** The founder proposes one or more times (or a new time for a meeting). */
  readonly propose: (input: ProposeInput) => Promise<ProposalOutcome>;
  /** Accept / decline / counter / accept a counter / re-propose. */
  readonly respond: (input: RespondInput) => Promise<ProposalOutcome>;
  /** Retries the booking of a CONFIRMED proposal whose booking has not landed. */
  readonly completeBooking: (input: {
    readonly actorUserId: string;
    readonly proposalId: string;
  }) => Promise<ProposalOutcome>;
  readonly list: (input: {
    readonly actorUserId: string;
    readonly relationshipId: string;
  }) => Promise<
    | { readonly outcome: "OK"; readonly proposals: readonly ProposalRecord[] }
    | { readonly outcome: "REFUSED"; readonly reason: ProposalRefusal }
  >;
};

const refused = (reason: ProposalRefusal): ProposalOutcome => ({
  outcome: "REFUSED",
  reason,
});

function validOptions(
  options: readonly TimeOption[] | undefined,
  now: Date,
): options is readonly TimeOption[] {
  if (options === undefined || options.length < 1 || options.length > 5) {
    return false;
  }
  return options.every((option) => {
    const start = Date.parse(option.startsAt);
    const end = Date.parse(option.endsAt);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start > now.getTime() &&
      start < now.getTime() + MAX_HORIZON_MS &&
      end > start &&
      end - start <= 8 * 3_600_000 &&
      /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(option.timeZone)
    );
  });
}

export function createProposalService(
  dependencies: ProposalServiceDependencies,
): ProposalService {
  const { store, parties, book, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const newId = dependencies.newId ?? (() => randomUUID());

  /** Books after the acceptance is recorded; a failure leaves it CONFIRMED and retryable. */
  async function bookAccepted(
    proposal: ProposalRecord,
  ): Promise<{ proposal: ProposalRecord; booked: boolean }> {
    if (proposal.meetingId !== null) return { proposal, booked: true };
    const list =
      proposal.acceptedFrom === "COUNTER_OPTIONS"
        ? (proposal.counterOptions ?? [])
        : proposal.options;
    const option = list[proposal.acceptedOption ?? -1];
    if (option === undefined) return { proposal, booked: false };
    try {
      const booked = await book({
        proposal,
        option,
        // One booking per acceptance, however often it is retried.
        idempotencyKey: `meeting-time-proposal:${proposal.id}:booking`,
      });
      if (booked === null) return { proposal, booked: false };
      await store.attachMeeting(proposal.id, booked.meetingId);
      return {
        proposal: { ...proposal, meetingId: booked.meetingId },
        booked: true,
      };
    } catch (error: unknown) {
      logger?.warn(
        { err: error, proposalId: proposal.id },
        "accepted meeting time not booked yet; it stays accepted and is retried",
      );
      return { proposal, booked: false };
    }
  }

  return {
    propose: async (input) => {
      const party = await parties({
        actorUserId: input.actorUserId,
        relationshipId: input.relationshipId,
      });
      if (party === null) return refused("NOT_A_PARTY");
      // The founder proposes; the investor responds. The side is derived
      // from membership, so a request cannot claim the other one.
      if (party.side !== "FOUNDER") return refused("ROLE_NOT_ALLOWED");
      if (!party.binds) return refused("NOT_AUTHORISED");
      if (!validOptions(input.options, now())) return refused("INVALID_OPTIONS");
      const existing = await store.findByKey(
        input.relationshipId,
        input.idempotencyKey,
      );
      if (existing !== null) {
        return {
          outcome: "OK",
          proposal: existing,
          recorded: false,
          confirmed: existing.state === "CONFIRMED",
          booked: existing.meetingId !== null,
        };
      }
      const id = newId();
      const record: ProposalRecord = {
        id,
        tenantId: party.tenantId,
        relationshipId: input.relationshipId,
        purpose: input.purpose.trim().slice(0, 500),
        proposedByUserId: input.actorUserId,
        state: "PROPOSED",
        options: input.options,
        counterOptions: null,
        acceptedFrom: null,
        acceptedOption: null,
        acceptedByUserId: null,
        acceptedAt: null,
        rescheduleOfMeetingId: input.rescheduleOfMeetingId ?? null,
        meetingId: null,
        revision: 1,
        idempotencyKey: input.idempotencyKey,
      };
      if (record.purpose.length === 0) return refused("INVALID_OPTIONS");
      await store.create(record, {
        proposalId: id,
        tenantId: party.tenantId,
        eventType: "PROPOSED",
        fromState: null,
        toState: "PROPOSED",
        actorUserId: input.actorUserId,
        actorSide: "FOUNDER",
        optionIndex: null,
        idempotencyKey: input.idempotencyKey,
      });
      // Delivered to the investor's review: the system's own step.
      return sendForReview(record);
    },

    respond: async (input) => {
      const current = await store.find(input.proposalId);
      if (current === null) return refused("NOT_FOUND");
      const party = await parties({
        actorUserId: input.actorUserId,
        relationshipId: current.relationshipId,
      });
      if (party === null) return refused("NOT_A_PARTY");
      // A replay of an action already recorded under this key is answered
      // from the record: no second transition, no second booking.
      const replay = await store.findEvent(current.id, input.idempotencyKey);
      if (replay !== null) {
        if (replay.actorUserId !== input.actorUserId) return refused("CONFLICT");
        const booked = await bookAccepted(current);
        return {
          outcome: "OK",
          proposal: booked.proposal,
          recorded: false,
          confirmed: current.state === "CONFIRMED",
          booked: booked.booked && current.state === "CONFIRMED",
        };
      }
      const result = transition(current.state, party.side, input.action);
      if (!result.ok) return refused(result.reason);
      // Only an authorised party binds their side (an accept, a decline, a
      // counter, a re-proposal all speak for the organisation).
      if (!party.binds) return refused("NOT_AUTHORISED");
      const now_ = now();
      const accepting =
        input.action === "ACCEPT" || input.action === "ACCEPT_COUNTER";
      const countering =
        input.action === "COUNTER" || input.action === "REPROPOSE";
      const pool =
        input.action === "ACCEPT_COUNTER"
          ? (current.counterOptions ?? [])
          : current.options;
      if (accepting) {
        const index = input.optionIndex;
        if (
          index === undefined ||
          !Number.isInteger(index) ||
          index < 0 ||
          pool[index] === undefined
        ) {
          return refused("INVALID_OPTION_INDEX");
        }
        // A time already past cannot be accepted.
        if (Date.parse(pool[index]?.startsAt ?? "") <= now_.getTime()) {
          return refused("INVALID_OPTIONS");
        }
      }
      if (countering && !validOptions(input.options, now_)) {
        return refused("INVALID_OPTIONS");
      }
      if (input.action === "REPROPOSE" && current.revision >= MAX_REVISIONS) {
        return refused("TOO_MANY_REVISIONS");
      }
      const patch: ProposalPatch = accepting
        ? {
            accepted: {
              from:
                input.action === "ACCEPT_COUNTER" ? "COUNTER_OPTIONS" : "OPTIONS",
              option: input.optionIndex ?? 0,
              byUserId: input.actorUserId,
              at: now_,
            },
          }
        : input.action === "COUNTER"
          ? { counterOptions: input.options ?? [] }
          : input.action === "REPROPOSE"
            ? {
                options: input.options ?? [],
                counterOptions: null,
                revisionIncrement: true,
              }
            : {};
      const applied = await store.apply({
        id: current.id,
        expected: current.state,
        patch,
        event: {
          proposalId: current.id,
          tenantId: current.tenantId,
          eventType: result.rule.event,
          fromState: current.state,
          toState: result.rule.to,
          actorUserId: input.actorUserId,
          actorSide: party.side,
          optionIndex: accepting ? (input.optionIndex ?? null) : null,
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (!applied) return refused("CONFLICT");
      const after = await store.find(current.id);
      if (after === null) return refused("NOT_FOUND");
      logger?.info(
        {
          proposalId: after.id,
          from: current.state,
          to: after.state,
          side: party.side,
        },
        "meeting time proposal moved",
      );
      if (after.state === "PROPOSED") return sendForReview(after);
      if (after.state !== "CONFIRMED") {
        return {
          outcome: "OK",
          proposal: after,
          recorded: true,
          confirmed: false,
          booked: false,
        };
      }
      const booked = await bookAccepted(after);
      return {
        outcome: "OK",
        proposal: booked.proposal,
        recorded: true,
        confirmed: true,
        booked: booked.booked,
      };
    },

    completeBooking: async (input) => {
      const current = await store.find(input.proposalId);
      if (current === null) return refused("NOT_FOUND");
      const party = await parties({
        actorUserId: input.actorUserId,
        relationshipId: current.relationshipId,
      });
      if (party === null) return refused("NOT_A_PARTY");
      if (current.state !== "CONFIRMED") return refused("INVALID_STATE");
      const booked = await bookAccepted(current);
      return {
        outcome: "OK",
        proposal: booked.proposal,
        recorded: false,
        confirmed: true,
        booked: booked.booked,
      };
    },

    list: async (input) => {
      const party = await parties({
        actorUserId: input.actorUserId,
        relationshipId: input.relationshipId,
      });
      if (party === null) return { outcome: "REFUSED", reason: "NOT_A_PARTY" };
      return {
        outcome: "OK",
        proposals: await store.listForRelationship(input.relationshipId, 50),
      };
    },
  };

  async function sendForReview(record: ProposalRecord): Promise<ProposalOutcome> {
    const result = transition(record.state, "SYSTEM", "SEND_FOR_REVIEW");
    if (!result.ok) return refused(result.reason);
    const applied = await store.apply({
      id: record.id,
      expected: record.state,
      patch: {},
      event: {
        proposalId: record.id,
        tenantId: record.tenantId,
        eventType: result.rule.event,
        fromState: record.state,
        toState: result.rule.to,
        actorUserId: null,
        actorSide: null,
        optionIndex: null,
        idempotencyKey: `system:review:${String(record.revision)}`,
      },
    });
    if (!applied) return refused("CONFLICT");
    const after = (await store.find(record.id)) ?? record;
    return {
      outcome: "OK",
      proposal: after,
      recorded: true,
      confirmed: false,
      booked: false,
    };
  }
}
