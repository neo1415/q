import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import type {
  ProposalEvent,
  ProposalParties,
  ProposalRecord,
  ProposalState,
  ProposalStore,
  TimeOption,
} from "./proposal.js";

/**
 * PostgreSQL for meeting time proposals, over the privileged server
 * connection (the tables are server-only). The service has already derived
 * the actor's side from membership; the state check in `apply` makes two
 * simultaneous responses safe (one wins, the other is a CONFLICT).
 */

type Row = {
  id: string;
  tenant_id: string;
  relationship_id: string;
  purpose: string;
  proposed_by_user_id: string;
  state: ProposalState;
  options: readonly TimeOption[];
  counter_options: readonly TimeOption[] | null;
  accepted_from: "OPTIONS" | "COUNTER_OPTIONS" | null;
  accepted_option: number | null;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  reschedule_of_meeting_id: string | null;
  meeting_id: string | null;
  revision: number;
  idempotency_key: string;
};

const toRecord = (row: Row): ProposalRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  relationshipId: row.relationship_id,
  purpose: row.purpose,
  proposedByUserId: row.proposed_by_user_id,
  state: row.state,
  options: row.options,
  counterOptions: row.counter_options,
  acceptedFrom: row.accepted_from,
  acceptedOption: row.accepted_option,
  acceptedByUserId: row.accepted_by_user_id,
  acceptedAt: row.accepted_at,
  rescheduleOfMeetingId: row.reschedule_of_meeting_id,
  meetingId: row.meeting_id,
  revision: row.revision,
  idempotencyKey: row.idempotency_key,
});

export function createPostgresProposalStore(options: {
  readonly transactions: TransactionManager;
}): ProposalStore {
  const { transactions } = options;
  const one = (id: string) =>
    transactions.run(async (tx) => {
      const rows = await tx.sql<Row[]>`
        select * from communication.meeting_time_proposals where id = ${id} limit 1`;
      return rows[0] ?? null;
    });

  const insertEvent = async (tx: TransactionContext, event: ProposalEvent) => {
    await tx.sql`
      insert into communication.meeting_time_proposal_events
        (proposal_id, tenant_id, event_type, from_state, to_state, actor_user_id,
         actor_side, option_index, idempotency_key)
      values (${event.proposalId}, ${event.tenantId}, ${event.eventType}, ${event.fromState},
              ${event.toState}, ${event.actorUserId}, ${event.actorSide},
              ${event.optionIndex}, ${event.idempotencyKey})`;
  };

  return {
    find: async (id) => {
      const row = await one(id);
      return row === null ? null : toRecord(row);
    },

    findEvent: (proposalId, idempotencyKey) =>
      transactions.run(async (tx) => {
        const rows = await tx.sql<
          {
            proposal_id: string;
            tenant_id: string;
            event_type: ProposalEvent["eventType"];
            from_state: ProposalState | null;
            to_state: ProposalState;
            actor_user_id: string | null;
            actor_side: ProposalEvent["actorSide"];
            option_index: number | null;
            idempotency_key: string;
          }[]
        >`
          select * from communication.meeting_time_proposal_events
           where proposal_id = ${proposalId} and idempotency_key = ${idempotencyKey}
           limit 1`;
        const row = rows[0];
        return row === undefined
          ? null
          : {
              proposalId: row.proposal_id,
              tenantId: row.tenant_id,
              eventType: row.event_type,
              fromState: row.from_state,
              toState: row.to_state,
              actorUserId: row.actor_user_id,
              actorSide: row.actor_side,
              optionIndex: row.option_index,
              idempotencyKey: row.idempotency_key,
            };
      }),

    findByKey: (relationshipId, idempotencyKey) =>
      transactions.run(async (tx) => {
        const rows = await tx.sql<Row[]>`
          select * from communication.meeting_time_proposals
           where relationship_id = ${relationshipId} and idempotency_key = ${idempotencyKey}
           limit 1`;
        return rows[0] === undefined ? null : toRecord(rows[0]);
      }),

    listForRelationship: (relationshipId, limit) =>
      transactions.run(async (tx) => {
        const rows = await tx.sql<Row[]>`
          select * from communication.meeting_time_proposals
           where relationship_id = ${relationshipId}
           order by created_at desc
           limit ${limit}`;
        return rows.map(toRecord);
      }),

    create: (record, event) =>
      transactions.run(async (tx) => {
        await tx.sql`
          insert into communication.meeting_time_proposals
            (id, tenant_id, relationship_id, purpose, proposed_by_user_id, state, options,
             reschedule_of_meeting_id, revision, idempotency_key)
          values (${record.id}, ${record.tenantId}, ${record.relationshipId}, ${record.purpose},
                  ${record.proposedByUserId}, ${record.state}, ${JSON.stringify(record.options)}::jsonb,
                  ${record.rescheduleOfMeetingId}, ${record.revision}, ${record.idempotencyKey})`;
        await insertEvent(tx, event);
      }),

    apply: ({ id, expected, patch, event }) =>
      transactions.run(async (tx) => {
        const accepted = patch.accepted;
        const json = (value: unknown) =>
          value === null || value === undefined ? null : JSON.stringify(value);
        const moved = await tx.sql<{ id: string }[]>`
          update communication.meeting_time_proposals
             set state = ${event.toState},
                 options = coalesce(${json(patch.options)}::jsonb, options),
                 counter_options = case when ${patch.counterOptions !== undefined}::boolean
                                        then ${json(patch.counterOptions)}::jsonb
                                        else counter_options end,
                 accepted_from = coalesce(${accepted?.from ?? null}, accepted_from),
                 accepted_option = coalesce(${accepted?.option ?? null}::integer, accepted_option),
                 accepted_by_user_id = coalesce(${accepted?.byUserId ?? null}::uuid, accepted_by_user_id),
                 accepted_at = coalesce(${accepted?.at ?? null}::timestamptz, accepted_at),
                 revision = revision + ${patch.revisionIncrement === true ? 1 : 0},
                 updated_at = clock_timestamp()
           where id = ${id} and state = ${expected}
           returning id`;
        if (moved.length === 0) return false;
        await insertEvent(tx, event);
        return true;
      }),

    attachMeeting: (id, meetingId) =>
      transactions.run(async (tx) => {
        await tx.sql`
          update communication.meeting_time_proposals
             set meeting_id = ${meetingId}, updated_at = clock_timestamp()
           where id = ${id} and state = 'CONFIRMED' and meeting_id is null`;
      }),
  };
}

/**
 * Who the actor is on a relationship, from their ACTIVE membership of the
 * company organisation (FOUNDER) or the investor organisation (INVESTOR).
 * Derived here, never taken from a request. Every active member is treated
 * as authorised to bind their side for now; narrowing that to a role or a
 * scoped delegation is a one-line change here, behind the same port.
 */
export function createPostgresProposalParties(options: {
  readonly transactions: TransactionManager;
}): ProposalParties {
  return ({ actorUserId, relationshipId }) =>
    options.transactions.run(async (tx) => {
      const rows = await tx.sql<
        { tenant_id: string; side: "FOUNDER" | "INVESTOR" | null }[]
      >`
        select r.tenant_id,
               case when exists (select 1 from identity.organisation_memberships om
                                  where om.user_id = ${actorUserId}
                                    and om.organisation_id = c.organisation_id
                                    and om.membership_status = 'active') then 'FOUNDER'
                    when exists (select 1 from identity.organisation_memberships om
                                  where om.user_id = ${actorUserId}
                                    and om.organisation_id = i.organisation_id
                                    and om.membership_status = 'active') then 'INVESTOR'
               end as side
          from network.relationships r
          join core.companies c on c.id = r.company_id
          join core.investor_organisations i on i.id = r.investor_organisation_id
         where r.id = ${relationshipId}
         limit 1`;
      const row = rows[0];
      if (row === undefined || row.side === null) return null;
      return { tenantId: row.tenant_id, side: row.side, binds: true };
    });
}
