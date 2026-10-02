import {
  isMatchedRelationshipState,
  type CorrelationId,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import type { ActorContext } from "@capital-q/security";

import { RelationshipIdSchema } from "../contracts/index.js";
import {
  RELATIONSHIP_EVENT_DILIGENCE_STARTED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED,
  RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
} from "../domain/event-registry.js";
import {
  relationshipOutcomeRecordedEvent,
  type RelationshipOutcome,
} from "../events/index.js";
import type { RelationshipEventAppender } from "./append-event.js";
import type { InterestService } from "./service.js";

/**
 * Post-meeting outcomes (founder request 2026-10-02; Product Specification
 * 6.6.10-6.6.14). The journey after "meeting held": an investor passes,
 * pauses or resumes; either side records that diligence started or that the
 * meeting moved things forward.
 *
 * Each is a relationship_* event on the history in one transaction with
 * its outbox announcement, and the deterministic projector (relationship-
 * state.v2) folds the state from it: nothing here writes a state.
 *
 * Party and side come from Network's own per-party view, never from input:
 * a relationship the caller is not a party to is the same "not found" as
 * one that does not exist. Only the investor side passes, pauses or resumes
 * (a founder cannot pass on themselves). A pass's reason is the investor's
 * private note (founder decision (a)): it lives in network.relationship_
 * passes, the shared event says only whether it was shared, and a founder
 * reads it only when shared.
 */

export type OutcomeRefusal =
  "NOT_FOUND" | "NOT_ALLOWED" | "NOT_IN_STATE" | "INVALID_REASON";

export type OutcomeResult =
  | {
      readonly outcome: "OK";
      readonly relationshipId: string;
      /** True when this was already the case: nothing new was recorded. */
      readonly deduplicated: boolean;
    }
  | { readonly outcome: "REFUSED"; readonly code: OutcomeRefusal };

export type PassReason = {
  readonly code: string;
  readonly label: string;
};

/** A pass as the asking side may see it. */
export type PassRecordView = {
  readonly passId: string;
  readonly passedAt: string;
  readonly reasonCode: string | null;
  readonly reasonLabel: string | null;
  readonly note: string | null;
  readonly sharedWithFounder: boolean;
};

/** Where a pass may be made from: a match the investor has not left. */
const PASSABLE = new Set([
  "CONNECTED",
  "MEETING_HELD",
  "IN_DILIGENCE",
  "PAUSED",
]);
const PAUSABLE = new Set(["CONNECTED", "MEETING_HELD", "IN_DILIGENCE"]);

/** The meeting outcomes either side may record, as bounded codes. */
export const PROGRESS_STEPS = [
  "FOLLOW_UP_MEETING",
  "MATERIALS_REQUESTED",
  "INTRODUCTIONS",
  "OTHER",
] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

export function createRelationshipOutcomeService(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly interests: Pick<InterestService, "relationshipById">;
  readonly appender: RelationshipEventAppender;
  readonly outbox: OutboxWriter;
  /**
   * The investor organisation's active mandate, recorded with a pass so a
   * changed mandate can reopen it (doc 19 §67). Absent: not recorded.
   */
  readonly activeMandate?:
    | ((
        actor: ActorContext,
        investorOrganisationId: string,
      ) => Promise<{
        readonly mandateId: string;
        readonly version: number;
      } | null>)
    | undefined;
  readonly newCorrelationId: () => CorrelationId;
}) {
  const { sql, transactions, interests, appender, outbox } = dependencies;

  async function partyOf(actor: ActorContext, relationshipId: string) {
    const parsed = RelationshipIdSchema.safeParse(relationshipId);
    if (!parsed.success) return null;
    const view = await interests
      .relationshipById({ actor, relationshipId: parsed.data })
      .catch(() => null);
    if (view === null || view.status === null) return null;
    const relationship = view.status.relationship;
    return {
      relationshipId: parsed.data,
      side: view.side,
      state: view.status.projection.state,
      tenantId: relationship.tenantId,
      companyId: relationship.companyId,
      investorOrganisationId: relationship.investorOrganisationId,
    };
  }

  type Party = NonNullable<Awaited<ReturnType<typeof partyOf>>>;

  async function record(
    actor: ActorContext,
    party: Party,
    input: {
      readonly eventType: string;
      readonly outcome: RelationshipOutcome;
      readonly payload: (
        passId: string | undefined,
      ) => Readonly<Record<string, unknown>>;
      readonly correlationId: CorrelationId;
      /**
       * Inside the same transaction, before the event: the pass row. Null:
       * it already existed (a replay), so nothing more is recorded.
       */
      readonly before?:
        | ((
            tx: Parameters<Parameters<TransactionManager["run"]>[0]>[0],
          ) => Promise<string | null>)
        | undefined;
    },
  ): Promise<boolean> {
    return transactions.run(async (tx) => {
      let passId: string | undefined;
      if (input.before !== undefined) {
        const made = await input.before(tx);
        if (made === null) return false;
        passId = made;
      }
      await appender.append(tx, {
        relationshipId: party.relationshipId,
        eventType: input.eventType,
        actor: { type: "HUMAN", id: actor.userId },
        source: {
          type: "MANUAL",
          ...(passId === undefined ? {} : { id: passId }),
        },
        // Both sides are its subject; the founder is owed an honest answer.
        visibilityScope: "relationship_shared",
        payload: input.payload(passId),
        correlationId: input.correlationId,
      });
      await outbox.enqueue(
        tx,
        relationshipOutcomeRecordedEvent({
          tenantId: party.tenantId,
          organisationId: actor.organisationId,
          actorUserId: actor.userId,
          correlationId: input.correlationId,
          relationshipId: party.relationshipId,
          companyId: party.companyId,
          investorOrganisationId: party.investorOrganisationId,
          outcome: input.outcome,
          side: party.side,
          passId,
        }),
      );
      return true;
    });
  }

  const ok = (
    relationshipId: string,
    deduplicated: boolean,
  ): OutcomeResult => ({
    outcome: "OK",
    relationshipId,
    deduplicated,
  });
  const refused = (code: OutcomeRefusal): OutcomeResult => ({
    outcome: "REFUSED",
    code,
  });

  return {
    /** The reason categories (reference data, Product Specification 6.6.10). */
    passReasons: async (): Promise<readonly PassReason[]> =>
      sql<{ code: string; label: string }[]>`
        select code, label from network.relationship_pass_reasons
         where active order by sort_order, code`,

    /** The investor decides not to proceed for now. Consequential. */
    pass: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly reasonCode?: string | null | undefined;
      readonly note?: string | null | undefined;
      readonly shareWithFounder: boolean;
      readonly idempotencyKey: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<OutcomeResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      // A founder cannot pass on themselves; only the investor side passes.
      if (party.side !== "INVESTOR") return refused("NOT_ALLOWED");
      const replay = await sql<{ id: string }[]>`
        select id from network.relationship_passes
         where passed_by_user_id = ${command.actor.userId}
           and idempotency_key = ${command.idempotencyKey}`;
      if (replay[0] !== undefined) return ok(party.relationshipId, true);
      if (party.state === "PASSED") return ok(party.relationshipId, true);
      if (!PASSABLE.has(party.state)) return refused("NOT_IN_STATE");
      const reasonCode = command.reasonCode ?? null;
      if (reasonCode !== null) {
        const known = await sql<{ code: string }[]>`
          select code from network.relationship_pass_reasons
           where code = ${reasonCode} and active`;
        if (known.length === 0) return refused("INVALID_REASON");
      }
      const note = command.note?.trim() === "" ? null : (command.note ?? null);
      // Sharing nothing would tell the founder nothing.
      const shared =
        command.shareWithFounder && (reasonCode !== null || note !== null);
      const mandate =
        dependencies.activeMandate === undefined
          ? null
          : await dependencies
              .activeMandate(command.actor, party.investorOrganisationId)
              .catch(() => null);
      const investorTenant = command.actor.tenantId;
      const recorded = await record(command.actor, party, {
        eventType: RELATIONSHIP_EVENT_RELATIONSHIP_PASSED,
        outcome: "PASSED",
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
        // The shared event says only whether a reason was shared.
        payload: (passId) => ({
          passId,
          side: "INVESTOR",
          reasonShared: shared,
        }),
        before: async (tx) => {
          const rows = await tx.sql<{ id: string }[]>`
            insert into network.relationship_passes
              (tenant_id, relationship_id, investor_organisation_id,
               passed_by_user_id, reason_code, note, share_with_founder,
               mandate_id, mandate_version, idempotency_key)
            values (${investorTenant}, ${party.relationshipId},
                    ${party.investorOrganisationId}, ${command.actor.userId},
                    ${reasonCode}, ${note}, ${shared},
                    ${mandate?.mandateId ?? null}, ${mandate?.version ?? null},
                    ${command.idempotencyKey})
            on conflict (passed_by_user_id, idempotency_key) do nothing
            returning id`;
          return rows[0]?.id ?? null;
        },
      });
      return ok(party.relationshipId, !recorded);
    },

    /** The investor pauses: not a pass, not a decline. */
    pause: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<OutcomeResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (party.side !== "INVESTOR") return refused("NOT_ALLOWED");
      if (party.state === "PAUSED") return ok(party.relationshipId, true);
      if (!PAUSABLE.has(party.state)) return refused("NOT_IN_STATE");
      await record(command.actor, party, {
        eventType: RELATIONSHIP_EVENT_RELATIONSHIP_PAUSED,
        outcome: "PAUSED",
        payload: () => ({ side: "INVESTOR" }),
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
      });
      return ok(party.relationshipId, false);
    },

    /**
     * Lifts a pause, or resets a pass (doc 19 §67: "investor resets pass"):
     * the relationship is back where it was before.
     */
    resume: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<OutcomeResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      if (party.side !== "INVESTOR") return refused("NOT_ALLOWED");
      if (party.state !== "PAUSED" && party.state !== "PASSED") {
        // Already open: a repeated resume is a no-op, never an error.
        return isMatchedRelationshipState(party.state)
          ? ok(party.relationshipId, true)
          : refused("NOT_IN_STATE");
      }
      await record(command.actor, party, {
        eventType: RELATIONSHIP_EVENT_RELATIONSHIP_RESUMED,
        outcome: "RESUMED",
        payload: () => ({ side: "INVESTOR" }),
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
      });
      return ok(party.relationshipId, false);
    },

    /**
     * A meeting's outcome, confirmed by a person (PADL #130: Q proposes,
     * the person confirms): diligence started, or the meeting moved things
     * forward. Either side of a live match.
     */
    recordMeetingOutcome: async (command: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
      readonly outcome:
        | { readonly kind: "DILIGENCE" }
        | { readonly kind: "PROGRESSED"; readonly step: ProgressStep };
      readonly meetingId?: string | undefined;
      readonly correlationId?: CorrelationId | undefined;
    }): Promise<OutcomeResult> => {
      const party = await partyOf(command.actor, command.relationshipId);
      if (party === null) return refused("NOT_FOUND");
      const meeting =
        command.meetingId === undefined ? {} : { meetingId: command.meetingId };
      if (command.outcome.kind === "DILIGENCE") {
        if (party.state === "IN_DILIGENCE")
          return ok(party.relationshipId, true);
        if (party.state !== "CONNECTED" && party.state !== "MEETING_HELD") {
          return refused("NOT_IN_STATE");
        }
        await record(command.actor, party, {
          eventType: RELATIONSHIP_EVENT_DILIGENCE_STARTED,
          outcome: "DILIGENCE_STARTED",
          payload: () => ({ side: party.side, ...meeting }),
          correlationId:
            command.correlationId ?? dependencies.newCorrelationId(),
        });
        return ok(party.relationshipId, false);
      }
      if (!PAUSABLE.has(party.state)) return refused("NOT_IN_STATE");
      const step = command.outcome.step;
      await record(command.actor, party, {
        eventType: RELATIONSHIP_EVENT_RELATIONSHIP_PROGRESSED,
        outcome: "PROGRESSED",
        payload: () => ({
          side: party.side,
          step,
          ...meeting,
        }),
        correlationId: command.correlationId ?? dependencies.newCorrelationId(),
      });
      return ok(party.relationshipId, false);
    },

    /**
     * The latest pass on a relationship as the asking side may see it:
     * everything for the investor side; for the company side only a pass
     * whose reason was shared, and null otherwise (they learn THAT the
     * investor passed from the state, never the private reason).
     */
    latestPass: async (query: {
      readonly actor: ActorContext;
      readonly relationshipId: string;
    }): Promise<PassRecordView | null> => {
      const party = await partyOf(query.actor, query.relationshipId);
      // A reset pass is history, not the current answer.
      if (party === null || party.state !== "PASSED") return null;
      const rows = await sql<
        {
          id: string;
          created_at: Date;
          reason_code: string | null;
          label: string | null;
          note: string | null;
          share_with_founder: boolean;
        }[]
      >`
        select p.id, p.created_at, p.reason_code, r.label, p.note,
               p.share_with_founder
          from network.relationship_passes p
          left join network.relationship_pass_reasons r on r.code = p.reason_code
         where p.relationship_id = ${party.relationshipId}
         order by p.created_at desc
         limit 1`;
      const row = rows[0];
      // The latest pass only: an older shared reason never stands in for
      // a newer private one.
      if (row === undefined) return null;
      if (party.side !== "INVESTOR" && !row.share_with_founder) return null;
      return {
        passId: row.id,
        passedAt: row.created_at.toISOString(),
        reasonCode: row.reason_code,
        reasonLabel: row.label,
        note: row.note,
        sharedWithFounder: row.share_with_founder,
      };
    },
  };
}

export type RelationshipOutcomeService = ReturnType<
  typeof createRelationshipOutcomeService
>;
