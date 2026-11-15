import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { CounterpartNotices } from "../counterpart-notices.js";

import {
  createProposalService,
  type ProposalParties,
  type ProposalRecord,
  type ProposalService,
  type ProposalStore,
  type TimeOption,
} from "./proposal.js";
import {
  createPostgresProposalParties,
  createPostgresProposalStore,
} from "./proposal-postgres.js";
import type { ScheduleService } from "./service.js";
import { meetingTimeLabel } from "./when.js";

/**
 * The composition of meeting time proposals for the app-action registry.
 *
 * `party` says who the actor is on a relationship (derived from active
 * membership, never from a request). `forActor` returns the proposal
 * service whose booking, after an acceptance is recorded, goes through the
 * existing schedule path as THAT person -- the accepting investor's own
 * calendar -- so the booking is never an action Q or the system takes on
 * its own authority. With no calendar connected (or its grant ended) the
 * agreed time is still recorded as a meeting through `recordAgreed`, the
 * same honest no-invite record errands write: no Meet link, and every
 * party told plainly that no calendar invite was sent and how to get one.
 * Any other failure leaves the proposal CONFIRMED and retryable.
 *
 * A proposal that moves an existing meeting (`rescheduleOfMeetingId`, live
 * audit 2026-11-14 D7) books nothing new: on acceptance THAT meeting moves
 * through the schedule service's own move (`moveAgreed`, the path Q's
 * `meeting.reschedule` uses, calendar-free for a time agreed without one),
 * as the accepting person. Without that path a move is refused, never
 * booked as a second meeting.
 */
export type MeetingProposalPort = {
  readonly party: ProposalParties;
  readonly forActor: (
    actor: ActorContext,
    correlationId: string,
  ) => ProposalService;
};

export function createMeetingProposalPort(options: {
  readonly transactions: TransactionManager;
  readonly schedule: Pick<ScheduleService, "schedule"> &
    Partial<
      Pick<
        ScheduleService,
        "recordAgreed" | "moveAgreed" | "agreedMoveRefusal" | "listMeetings"
      >
    >;
  /** The other side hears that times were proposed or countered. */
  readonly counterpartNotices?: Pick<CounterpartNotices, "notify"> | undefined;
  readonly logger?: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
  /** Tests only: an in-memory store and party resolver in place of Postgres. */
  readonly store?: ProposalStore | undefined;
  readonly parties?: ProposalParties | undefined;
}): MeetingProposalPort {
  const store =
    options.store ??
    createPostgresProposalStore({ transactions: options.transactions });
  const parties =
    options.parties ??
    createPostgresProposalParties({ transactions: options.transactions });
  return {
    party: parties,
    forActor: (actor, correlationId) =>
      createProposalService({
        store,
        parties,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        ...(options.counterpartNotices === undefined
          ? {}
          : {
              notify: noticesFor(options.counterpartNotices, async (p) => {
                // D10: the call a move proposal moves, read as the actor
                // (a party to the relationship) for its current time.
                const list = options.schedule.listMeetings;
                const moveOf = p.rescheduleOfMeetingId;
                if (list === undefined || moveOf === null) return null;
                const meetings = await list(actor, p.relationshipId).catch(
                  () => null,
                );
                const meeting = meetings?.find((m) => m.id === moveOf);
                return meeting === undefined
                  ? null
                  : { startsAt: meeting.startsAt, timeZone: meeting.timeZone };
              }),
            }),
        movable: async (input) => {
          const check = options.schedule.agreedMoveRefusal;
          if (check === undefined || options.schedule.moveAgreed === undefined)
            return false;
          const refusal = await check({
            actor,
            relationshipId: input.relationshipId,
            meetingId: input.meetingId,
            proposedByUserId: input.proposedByUserId,
          });
          if (refusal !== null) {
            options.logger?.info(
              { meetingId: input.meetingId, refusal },
              "meeting move proposal refused",
            );
          }
          return refusal === null;
        },
        book: async ({ proposal, option, idempotencyKey }) => {
          const minutes = Math.round(
            (Date.parse(option.endsAt) - Date.parse(option.startsAt)) / 60_000,
          );
          const durationMinutes = Math.min(180, Math.max(15, minutes));
          if (proposal.rescheduleOfMeetingId !== null) {
            const move = options.schedule.moveAgreed;
            if (move === undefined) return null;
            // Idempotent by the new time: a retried booking is the same move.
            const moved = await move({
              actor,
              relationshipId: proposal.relationshipId,
              meetingId: proposal.rescheduleOfMeetingId,
              proposedByUserId: proposal.proposedByUserId,
              startsAt: new Date(option.startsAt),
              durationMinutes,
              correlationId,
            });
            options.logger?.info(
              { proposalId: proposal.id, outcome: moved.outcome },
              "accepted meeting move applied",
            );
            return moved.outcome === "OK"
              ? {
                  meetingId: moved.meeting.id,
                  calendarInvite: moved.calendarUpdated,
                }
              : null;
          }
          const booked = await options.schedule.schedule({
            actor,
            relationshipId: proposal.relationshipId,
            purpose: proposal.purpose,
            startsAt: new Date(option.startsAt),
            durationMinutes,
            timeZone: option.timeZone,
            idempotencyKey,
            correlationId,
          });
          if (booked.outcome === "OK") {
            return { meetingId: booked.meeting.id, calendarInvite: true };
          }
          const recordAgreed = options.schedule.recordAgreed;
          if (
            booked.outcome !== "REFUSED" ||
            (booked.code !== "CALENDAR_NOT_CONNECTED" &&
              booked.code !== "CALENDAR_REVOKED") ||
            recordAgreed === undefined
          ) {
            return null;
          }
          // The accepting person's own record of the agreed time (never
          // Q's): the same meeting row, relationship event and notices,
          // without a calendar. Its own key, apart from the calendar path's.
          const agreed = await recordAgreed({
            actor,
            relationshipId: proposal.relationshipId,
            purpose: proposal.purpose,
            startsAt: new Date(option.startsAt),
            durationMinutes,
            timeZone: option.timeZone,
            idempotencyKey: `${idempotencyKey}:no-calendar`,
            correlationId,
            noInviteNote: noInviteNote(booked.code),
          });
          options.logger?.info(
            { proposalId: proposal.id, outcome: agreed.outcome },
            "accepted meeting time recorded without a calendar",
          );
          return agreed.outcome === "OK"
            ? { meetingId: agreed.meeting.id, calendarInvite: false }
            : null;
        },
      }),
  };
}

/** The plain words every party reads when the call has no calendar invite. */
export function noInviteNote(
  reason: "CALENDAR_NOT_CONNECTED" | "CALENDAR_REVOKED",
): string {
  return reason === "CALENDAR_REVOKED"
    ? "No calendar invite was sent: the Google Calendar connection has ended. The time is agreed on Capital Q. To send an invite with a Meet link, reconnect Google Calendar in Settings, or share a video link in the chat."
    : "No calendar invite was sent: no Google Calendar is connected. The time is agreed on Capital Q. To send an invite with a Meet link, connect Google Calendar in Settings, or share a video link in the chat.";
}

/**
 * The options as people read them: local time in a named zone (the
 * recipient's own when given, else each option's own), never a raw UTC
 * instant under a zone label (live audit 2026-11-14 D2).
 */
export function timesOf(
  options: readonly TimeOption[],
  recipientZone?: string,
): string {
  return options
    .map(
      (option, index) =>
        `${String(index + 1)}. ${meetingTimeLabel(option.startsAt, recipientZone ?? option.timeZone)}`,
    )
    .join("\n");
}

/**
 * TIME_PROPOSED to the other side: the investor for a proposal or
 * re-proposal, the founder for a counter, and whoever was waiting when the
 * times are declined. Once per proposal and revision (the notice's dedupe
 * key), however often the step is retried.
 */
function noticesFor(
  notices: Pick<CounterpartNotices, "notify">,
  bookedTime: (
    proposal: ProposalRecord,
  ) => Promise<{ readonly startsAt: string; readonly timeZone: string } | null>,
): NonNullable<Parameters<typeof createProposalService>[0]["notify"]> {
  return async ({ proposal, kind }) => {
    const revision = `proposal:${proposal.id}:r${String(proposal.revision)}`;
    if (kind === "DECLINED" || kind === "COUNTER_DECLINED") {
      // The investor declined the founder's times, or the founder declined
      // the investor's counter: the side waiting on an answer hears it.
      const investorDeclined = kind === "DECLINED";
      const declined = investorDeclined
        ? proposal.options
        : (proposal.counterOptions ?? []);
      // D8: only the company side proposes, so each side reads the step
      // that is actually theirs.
      const next = investorDeclined
        ? "You can propose other times on the relationship page."
        : "They may suggest new times, or you can message them on the relationship page.";
      // D10: a declined move leaves the booked call where it is.
      const standing =
        proposal.rescheduleOfMeetingId === null
          ? "Nothing is booked."
          : "The call stays as booked.";
      const body = (zone?: string) =>
        `${proposal.purpose}\n${timesOf(declined, zone)}\n${standing} ${next}`;
      await notices.notify({
        relationshipId: proposal.relationshipId,
        actingSide: investorDeclined ? "INVESTOR" : "COMPANY",
        kind: "TIME_PROPOSED",
        title: investorDeclined
          ? "{actor} declined the proposed call times"
          : "{actor} declined the times you suggested",
        body: body(),
        bodyInZone: body,
        target: "RELATIONSHIP",
        key: `${revision}:${investorDeclined ? "declined" : "counter-declined"}`,
        priority: "UPDATE",
      });
      return;
    }
    const countered = kind === "COUNTERPROPOSED";
    const offered = countered
      ? (proposal.counterOptions ?? [])
      : proposal.options;
    // D10: a move says it is one -- the call is booked and stays as it is
    // until a new time is accepted -- never "nothing is booked".
    const moving = proposal.rescheduleOfMeetingId !== null;
    const booked = moving ? await bookedTime(proposal).catch(() => null) : null;
    const body = (zone?: string) =>
      moving
        ? `${proposal.purpose}\n${
            booked === null
              ? "This moves the call already booked."
              : `This moves the call booked for ${meetingTimeLabel(booked.startsAt, zone ?? booked.timeZone)}.`
          } ${countered ? "Other times suggested:" : "Proposed new times:"}\n${timesOf(offered, zone)}\nThe call stays as booked until a new time is accepted.`
        : `${proposal.purpose}\n${timesOf(offered, zone)}\nNothing is booked until a time is accepted.`;
    await notices.notify({
      relationshipId: proposal.relationshipId,
      actingSide: countered ? "INVESTOR" : "COMPANY",
      kind: "TIME_PROPOSED",
      title: moving
        ? countered
          ? "{actor} suggested other times to move the call"
          : "{actor} proposed moving your call"
        : countered
          ? "{actor} suggested other times for the call"
          : "{actor} proposed times for a call",
      body: body(),
      bodyInZone: body,
      target: "RELATIONSHIP",
      key: `${revision}${countered ? ":counter" : ""}`,
      priority: "NEEDS_YOU",
    });
  };
}
