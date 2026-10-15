import type { TransactionManager } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createProposalService,
  type ProposalParties,
  type ProposalService,
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
 * its own authority. A booking that cannot land (calendar not connected)
 * leaves the proposal CONFIRMED and retryable.
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
  readonly schedule: Pick<ScheduleService, "schedule">;
  readonly logger?: {
    readonly info: (fields: Record<string, unknown>, message: string) => void;
    readonly warn: (fields: Record<string, unknown>, message: string) => void;
  };
}): MeetingProposalPort {
  const store = createPostgresProposalStore({
    transactions: options.transactions,
  });
  const parties = createPostgresProposalParties({
    transactions: options.transactions,
  });
  return {
    party: parties,
    forActor: (actor, correlationId) =>
      createProposalService({
        store,
        parties,
        ...(options.logger === undefined ? {} : { logger: options.logger }),
        book: async ({ proposal, option, idempotencyKey }) => {
          const minutes = Math.round(
            (Date.parse(option.endsAt) - Date.parse(option.startsAt)) / 60_000,
          );
          const booked = await options.schedule.schedule({
            actor,
            relationshipId: proposal.relationshipId,
            purpose: proposal.purpose,
            startsAt: new Date(option.startsAt),
            durationMinutes: Math.min(180, Math.max(15, minutes)),
            timeZone: option.timeZone,
            idempotencyKey,
            correlationId,
          });
          return booked.outcome === "OK"
            ? { meetingId: booked.meeting.id }
            : null;
        },
      }),
  };
}
