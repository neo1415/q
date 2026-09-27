import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import type { ChatSafetyStore } from "./safety-store.js";
import type { ChatSide } from "./store.js";

/**
 * PostgreSQL for `communication.blocks` and `communication.reports` (R34
 * safety), over the privileged server connection: the service has already
 * authorised the caller as a party for `side`. The tenant and both party
 * organisations come from the canonical relationship row.
 */

type Sql = DatabaseExecutor | TransactionContext["sql"];

const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown }).code === "23505";

/** The party organisations of a relationship, by side. */
async function partiesOf(
  sql: Sql,
  relationshipId: string,
  side: ChatSide,
): Promise<{ tenantId: string; own: string; other: string } | null> {
  const rows = await sql<
    { tenant_id: string; company_org: string; investor_org: string }[]
  >`
    select r.tenant_id, co.organisation_id as company_org, io.organisation_id as investor_org
      from network.relationships r
      join core.companies co on co.id = r.company_id
      join core.investor_organisations io on io.id = r.investor_organisation_id
     where r.id = ${relationshipId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return side === "COMPANY"
    ? { tenantId: row.tenant_id, own: row.company_org, other: row.investor_org }
    : { tenantId: row.tenant_id, own: row.investor_org, other: row.company_org };
}

export function createPostgresChatSafetyStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): ChatSafetyStore {
  const { sql, transactions } = options;

  const blockByKey = async (db: Sql, userId: string, key: string) => {
    const rows = await db<{ id: string; relationship_id: string }[]>`
      select id, relationship_id from communication.blocks
       where blocker_user_id = ${userId} and idempotency_key = ${key}`;
    return rows[0] ?? null;
  };
  const activeBlock = async (db: Sql, relationshipId: string, side: ChatSide) => {
    const rows = await db<{ id: string }[]>`
      select id from communication.blocks
       where relationship_id = ${relationshipId} and blocker_side = ${side}
         and lifted_at is null`;
    return rows[0]?.id ?? null;
  };

  type ReportRow = {
    id: string;
    relationship_id: string;
    message_id: string | null;
    reason_code: string;
    note: string | null;
  };
  const reportByKey = async (db: Sql, userId: string, key: string) => {
    const rows = await db<ReportRow[]>`
      select id, relationship_id, message_id, reason_code, note
        from communication.reports
       where reporter_user_id = ${userId} and idempotency_key = ${key}`;
    return rows[0] ?? null;
  };

  const block: ChatSafetyStore["block"] = (input) =>
    transactions.run(async (tx) => {
      const byKey = await blockByKey(tx.sql, input.userId, input.idempotencyKey);
      if (byKey !== null) {
        return byKey.relationship_id === input.relationshipId
          ? { outcome: "BLOCKED" as const, blockId: byKey.id, deduplicated: true }
          : { outcome: "KEY_CONFLICT" as const };
      }
      // Already blocked by this side (another member pressed Block first).
      const active = await activeBlock(tx.sql, input.relationshipId, input.side);
      if (active !== null) {
        return { outcome: "BLOCKED" as const, blockId: active, deduplicated: true };
      }
      const parties = await partiesOf(tx.sql, input.relationshipId, input.side);
      if (parties === null) throw new Error("relationship vanished while blocking");
      const inserted = await tx.sql<{ id: string }[]>`
        insert into communication.blocks
          (tenant_id, relationship_id, blocker_organisation_id, blocker_user_id,
           blocker_side, blocked_organisation_id, idempotency_key)
        values (${parties.tenantId}, ${input.relationshipId}, ${parties.own},
                ${input.userId}, ${input.side}, ${parties.other}, ${input.idempotencyKey})
        returning id`;
      const id = inserted[0]?.id;
      if (id === undefined) throw new Error("block insert returned nothing");
      await input.audit(tx, id);
      return { outcome: "BLOCKED" as const, blockId: id, deduplicated: false };
    });

  const report: ChatSafetyStore["report"] = (input) =>
    transactions.run(async (tx) => {
      const byKey = await reportByKey(tx.sql, input.userId, input.idempotencyKey);
      if (byKey !== null) {
        const same =
          byKey.relationship_id === input.relationshipId &&
          byKey.message_id === input.messageId &&
          byKey.reason_code === input.reasonCode &&
          byKey.note === input.note;
        return same
          ? { outcome: "REPORTED" as const, reportId: byKey.id, deduplicated: true }
          : { outcome: "KEY_CONFLICT" as const };
      }
      const reasons = await tx.sql<{ code: string }[]>`
        select code from communication.report_reasons
         where code = ${input.reasonCode} and active`;
      if (reasons.length === 0) return { outcome: "UNKNOWN_REASON" as const };
      if (input.messageId !== null) {
        // Only an original the other side sent on this relationship's thread.
        const messages = await tx.sql<{ id: string }[]>`
          select m.id from communication.messages m
            join communication.conversations c on c.id = m.conversation_id
           where m.id = ${input.messageId}
             and c.relationship_id = ${input.relationshipId}
             and m.revises_message_id is null
             and m.sender_side <> ${input.side}`;
        if (messages.length === 0) return { outcome: "MESSAGE_NOT_FOUND" as const };
      }
      const parties = await partiesOf(tx.sql, input.relationshipId, input.side);
      if (parties === null) throw new Error("relationship vanished while reporting");
      const inserted = await tx.sql<{ id: string }[]>`
        insert into communication.reports
          (tenant_id, relationship_id, message_id, reporter_organisation_id,
           reporter_user_id, reason_code, note, idempotency_key)
        values (${parties.tenantId}, ${input.relationshipId}, ${input.messageId},
                ${parties.own}, ${input.userId}, ${input.reasonCode}, ${input.note},
                ${input.idempotencyKey})
        returning id`;
      const id = inserted[0]?.id;
      if (id === undefined) throw new Error("report insert returned nothing");
      await input.audit(tx, id);
      return { outcome: "REPORTED" as const, reportId: id, deduplicated: false };
    });

  return {
    block: async (input) => {
      try {
        return await block(input);
      } catch (error) {
        // A concurrent Block (same key, or same side) won the race.
        if (isUniqueViolation(error)) {
          const byKey = await blockByKey(sql, input.userId, input.idempotencyKey);
          if (byKey !== null && byKey.relationship_id === input.relationshipId) {
            return { outcome: "BLOCKED", blockId: byKey.id, deduplicated: true };
          }
          const active = await activeBlock(sql, input.relationshipId, input.side);
          if (active !== null) {
            return { outcome: "BLOCKED", blockId: active, deduplicated: true };
          }
        }
        throw error;
      }
    },

    unblock: (input) =>
      transactions.run(async (tx) => {
        const lifted = await tx.sql<{ id: string }[]>`
          update communication.blocks
             set lifted_at = clock_timestamp(), lifted_by_user_id = ${input.userId}
           where relationship_id = ${input.relationshipId}
             and blocker_side = ${input.side}
             and lifted_at is null
          returning id`;
        const id = lifted[0]?.id;
        if (id === undefined) return { lifted: false };
        await input.audit(tx, id);
        return { lifted: true };
      }),

    report: async (input) => {
      try {
        return await report(input);
      } catch (error) {
        if (isUniqueViolation(error)) {
          const byKey = await reportByKey(sql, input.userId, input.idempotencyKey);
          if (byKey !== null) {
            return byKey.relationship_id === input.relationshipId &&
              byKey.message_id === input.messageId &&
              byKey.reason_code === input.reasonCode &&
              byKey.note === input.note
              ? { outcome: "REPORTED", reportId: byKey.id, deduplicated: true }
              : { outcome: "KEY_CONFLICT" };
          }
        }
        throw error;
      }
    },
  };
}
