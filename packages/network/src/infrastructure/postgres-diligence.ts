import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";

/**
 * Diligence requests and their fulfilments (2026-10-02). Parameterised SQL
 * under the application's trusted connection; the owning service decides
 * the party and the side before any of this runs. Append-only rows.
 */

export type DiligenceRequestRecord = {
  readonly id: string;
  readonly relationshipId: string;
  readonly requestedByUserId: string;
  readonly title: string;
  readonly note: string | null;
  readonly createdAt: string;
  readonly fulfilment: {
    readonly documentId: string;
    readonly disclosurePolicyId: string;
    readonly at: string;
  } | null;
};

type Row = {
  id: string;
  relationship_id: string;
  requested_by_user_id: string;
  title: string;
  note: string | null;
  created_at: Date;
  document_id: string | null;
  disclosure_policy_id: string | null;
  fulfilled_at: Date | null;
};

const toRecord = (row: Row): DiligenceRequestRecord => ({
  id: row.id,
  relationshipId: row.relationship_id,
  requestedByUserId: row.requested_by_user_id,
  title: row.title,
  note: row.note,
  createdAt: row.created_at.toISOString(),
  fulfilment:
    row.document_id === null ||
    row.disclosure_policy_id === null ||
    row.fulfilled_at === null
      ? null
      : {
          documentId: row.document_id,
          disclosurePolicyId: row.disclosure_policy_id,
          at: row.fulfilled_at.toISOString(),
        },
});

export function createPostgresDiligenceRequests() {
  const select = (executor: DatabaseExecutor) => executor`
    select q.id, q.relationship_id, q.requested_by_user_id, q.title, q.note,
           q.created_at, f.document_id, f.disclosure_policy_id,
           f.created_at as fulfilled_at
      from network.diligence_requests q
      left join network.diligence_fulfilments f on f.request_id = q.id`;
  return {
    /** A new request, or the one this person's key already made. */
    insert: async (
      tx: TransactionContext,
      input: {
        readonly tenantId: string;
        readonly relationshipId: string;
        readonly userId: string;
        readonly title: string;
        readonly note: string | null;
        readonly idempotencyKey: string;
      },
    ): Promise<{ readonly id: string; readonly created: boolean }> => {
      const made = await tx.sql<{ id: string }[]>`
        insert into network.diligence_requests
          (tenant_id, relationship_id, requested_by_user_id, title, note, idempotency_key)
        values (${input.tenantId}, ${input.relationshipId}, ${input.userId},
                ${input.title}, ${input.note}, ${input.idempotencyKey})
        on conflict (requested_by_user_id, idempotency_key) do nothing
        returning id`;
      const id = made[0]?.id;
      if (id !== undefined) return { id, created: true };
      const existing = await tx.sql<{ id: string }[]>`
        select id from network.diligence_requests
         where requested_by_user_id = ${input.userId}
           and idempotency_key = ${input.idempotencyKey}
           and relationship_id = ${input.relationshipId}`;
      const replayed = existing[0]?.id;
      if (replayed === undefined) throw new Error("DILIGENCE_KEY_REUSED");
      return { id: replayed, created: false };
    },
    listForRelationship: async (
      executor: DatabaseExecutor,
      relationshipId: string,
    ): Promise<readonly DiligenceRequestRecord[]> => {
      const rows = await executor<Row[]>`
        ${select(executor)}
         where q.relationship_id = ${relationshipId}
         order by q.created_at, q.id
         limit 200`;
      return rows.map(toRecord);
    },
    find: async (
      executor: DatabaseExecutor,
      requestId: string,
    ): Promise<DiligenceRequestRecord | null> => {
      const rows = await executor<Row[]>`
        ${select(executor)}
         where q.id = ${requestId}`;
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },
    /** One fulfilment per request; a second is a no-op. */
    fulfil: async (
      tx: TransactionContext,
      input: {
        readonly requestId: string;
        readonly tenantId: string;
        readonly disclosurePolicyId: string;
        readonly documentId: string;
        readonly userId: string;
      },
    ): Promise<boolean> => {
      const rows = await tx.sql<{ request_id: string }[]>`
        insert into network.diligence_fulfilments
          (request_id, tenant_id, disclosure_policy_id, document_id, fulfilled_by_user_id)
        values (${input.requestId}, ${input.tenantId}, ${input.disclosurePolicyId},
                ${input.documentId}, ${input.userId})
        on conflict (request_id) do nothing
        returning request_id`;
      return rows.length > 0;
    },
  };
}

export type DiligenceRequestRepository = ReturnType<
  typeof createPostgresDiligenceRequests
>;
