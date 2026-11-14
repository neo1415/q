import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import type { CounterpartNotices } from "../counterpart-notices.js";

import {
  createProposalService,
  type ProposalParties,
  type ProposalService,
  type ProposalStore,
  type TimeOption,
} from "./proposal.js";
import {
  createPostgresProposalParties,
  createPostgresProposalStore,
} from "./proposal-postgres.js";
import type { ScheduleService } from "./service.js";

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
    Partial<Pick<ScheduleService, "recordAgreed">>;
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
          : { notify: noticesFor(options.counterpartNotices) }),
        book: async ({ proposal, option, idempotencyKey }) => {
          const minutes = Math.round(
            (Date.parse(option.endsAt) - Date.parse(option.startsAt)) / 60_000,
          );
          const durationMinutes = Math.min(180, Math.max(15, minutes));
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

function timesOf(options: readonly TimeOption[]): string {
  return options
    .map(
      (option, index) =>
        `${String(index + 1)}. ${option.startsAt} (${option.timeZone})`,
    )
    .join("\n");
}

/**
 * TIME_PROPOSED to the other side: the investor for a proposal or
 * re-proposal, the founder for a counter. Once per proposal and revision
 * (the notice's dedupe key), however often the step is retried.
 */
function noticesFor(
  notices: Pick<CounterpartNotices, "notify">,
): NonNullable<Parameters<typeof createProposalService>[0]["notify"]> {
  return async ({ proposal, kind }) => {
    const countered = kind === "COUNTERPROPOSED";
    await notices.notify({
      relationshipId: proposal.relationshipId,
      actingSide: countered ? "INVESTOR" : "COMPANY",
      kind: "TIME_PROPOSED",
      title: countered
        ? "{actor} suggested other times for the call"
        : "{actor} proposed times for a call",
      body: `${proposal.purpose}\n${timesOf(
        countered ? (proposal.counterOptions ?? []) : proposal.options,
      )}\nNothing is booked until a time is accepted.`,
      target: "RELATIONSHIP",
      key: `proposal:${proposal.id}:r${String(proposal.revision)}${countered ? ":counter" : ""}`,
      priority: "NEEDS_YOU",
    });
  };
}
