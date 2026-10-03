import { CorrelationIdSchema, type CapitalQEvent } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipEventAppender,
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RELATIONSHIP_EVENT_MESSAGE_SENT,
  RelationshipIdSchema,
} from "@capital-q/network";
import { relationshipMessageSentEvent } from "@capital-q/network/events";

import { ChatBlockedError } from "./errors.js";
import type {
  AppendChatMessageInput,
  ChatConversation,
  ChatMessageRow,
  ChatStore,
} from "./store.js";

/**
 * PostgreSQL for `communication.*` (R34), over the privileged server
 * connection: the service has already authorised the caller as a party.
 * Messages are only ever inserted (the table refuses UPDATE and DELETE);
 * the read cursor is the one row that moves, and only forward.
 */

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_name: string | null;
  sender_side: ChatMessageRow["senderSide"];
  kind: ChatMessageRow["kind"];
  body: string | null;
  document_id: string | null;
  document_version_id: string | null;
  document_tenant_id: string | null;
  attachment_title: string | null;
  attachment_mime_type: string | null;
  attachment_size_bytes: string | number | null;
  voice_duration_ms: number | null;
  revises_message_id: string | null;
  q_action_id: string | null;
  q_delegation_id: string | null;
  q_envelope: unknown;
  created_at: Date;
};

function toRow(row: MessageRow): ChatMessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name?.trim() || "Someone",
    senderSide: row.sender_side,
    kind: row.kind,
    body: row.body,
    attachment:
      row.document_id === null ||
      row.document_version_id === null ||
      row.document_tenant_id === null ||
      row.attachment_title === null ||
      row.attachment_mime_type === null
        ? null
        : {
            documentId: row.document_id,
            documentVersionId: row.document_version_id,
            documentTenantId: row.document_tenant_id,
            title: row.attachment_title,
            mimeType: row.attachment_mime_type,
            sizeBytes:
              row.attachment_size_bytes === null
                ? null
                : Number(row.attachment_size_bytes),
          },
    voiceDurationMs: row.voice_duration_ms,
    revisesMessageId: row.revises_message_id,
    qActionId: row.q_action_id,
    qDelegationId: row.q_delegation_id,
    qEnvelope: row.q_envelope,
    createdAt: row.created_at,
  };
}

// The sender's name as a person sees it; never an email address.
const SELECT_MESSAGE = (sql: DatabaseExecutor) => sql`
  select m.id, m.conversation_id, m.sender_user_id,
         coalesce(nullif(btrim(p.display_name), ''),
                  nullif(btrim(concat_ws(' ', p.given_name, p.family_name)), '')) as sender_name,
         m.sender_side, m.kind, m.body, m.document_id, m.document_version_id,
         m.document_tenant_id, m.attachment_title,
         m.attachment_mime_type, m.attachment_size_bytes, m.voice_duration_ms,
         m.revises_message_id, m.q_action_id, m.q_delegation_id, m.q_envelope,
         m.created_at
    from communication.messages m
    join identity.user_profiles p on p.id = m.sender_user_id`;

/** The transactional outbox, as the composition provides it. */
export type ChatOutbox = {
  readonly enqueue: (
    tx: TransactionContext,
    event: CapitalQEvent<unknown>,
  ) => Promise<unknown>;
};

export function createPostgresChatStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /**
   * QA run 8a1d57b9: each original message is announced through the
   * outbox in its own transaction (`network.relationship.message_sent`), so
   * the other side is told and a standing instruction wakes promptly.
   */
  readonly outbox?: ChatOutbox | undefined;
}): ChatStore {
  const { sql, transactions } = options;
  const appender = createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  });

  const conversationIn = async (
    executor: DatabaseExecutor | TransactionContext["sql"],
    relationshipId: string,
  ): Promise<ChatConversation | null> => {
    const rows = await executor<
      { id: string; tenant_id: string; relationship_id: string }[]
    >`select id, tenant_id, relationship_id from communication.conversations
       where relationship_id = ${relationshipId}`;
    const row = rows[0];
    return row === undefined
      ? null
      : {
          id: row.id,
          tenantId: row.tenant_id,
          relationshipId: row.relationship_id,
        };
  };

  const findBySenderKey = async (
    executor: DatabaseExecutor | TransactionContext["sql"],
    senderUserId: string,
    key: string,
  ): Promise<ChatMessageRow | null> => {
    const rows = await executor<MessageRow[]>`${SELECT_MESSAGE(executor)}
      where m.sender_user_id = ${senderUserId} and m.idempotency_key = ${key}`;
    const row = rows[0];
    return row === undefined ? null : toRow(row);
  };

  const insert = (input: AppendChatMessageInput) =>
    transactions.run(async (tx) => {
      const existing = await findBySenderKey(
        tx.sql,
        input.senderUserId,
        input.idempotencyKey,
      );
      if (existing !== null) return { row: existing, deduplicated: true };

      // The thread is created on first use, from the canonical row: its
      // tenant is the relationship's, never an input.
      await tx.sql`insert into communication.conversations (tenant_id, relationship_id)
        select r.tenant_id, r.id from network.relationships r where r.id = ${input.relationshipId}
        on conflict (relationship_id) do nothing`;
      const conversation = await conversationIn(tx.sql, input.relationshipId);
      if (conversation === null) {
        throw new Error("relationship vanished while sending a message");
      }
      const inserted = await tx.sql<{ id: string }[]>`
        insert into communication.messages
          (tenant_id, conversation_id, sender_user_id, sender_side, kind, body,
           document_id, document_version_id, document_tenant_id,
           attachment_title, attachment_mime_type, attachment_size_bytes,
           voice_duration_ms, revises_message_id, q_action_id, q_delegation_id,
           q_envelope, idempotency_key)
        values (${conversation.tenantId}, ${conversation.id}, ${input.senderUserId},
                ${input.senderSide}, ${input.kind}, ${input.body},
                ${input.attachment?.documentId ?? null},
                ${input.attachment?.documentVersionId ?? null},
                ${input.attachment?.documentTenantId ?? null},
                ${input.attachment?.title ?? null},
                ${input.attachment?.mimeType ?? null}, ${input.attachment?.sizeBytes ?? null},
                ${input.voiceDurationMs}, ${input.revisesMessageId}, ${input.qActionId},
                ${input.qDelegationId ?? null},
                ${input.qEnvelope === undefined || input.qEnvelope === null ? null : tx.sql.json(JSON.parse(JSON.stringify(input.qEnvelope)) as Parameters<typeof tx.sql.json>[0])},
                ${input.idempotencyKey})
        returning id`;
      const id = inserted[0]?.id;
      if (id === undefined) throw new Error("message insert returned nothing");

      if (input.revisesMessageId === null) {
        // Activity on the relationship history, never a state move. The
        // payload names the message, never its words.
        await appender.append(tx, {
          relationshipId: RelationshipIdSchema.parse(input.relationshipId),
          eventType: RELATIONSHIP_EVENT_MESSAGE_SENT,
          actor: { type: "HUMAN", id: input.senderUserId },
          source: { type: input.qActionId === null ? "MANUAL" : "Q", id },
          visibilityScope: "relationship_shared",
          payload: { messageId: id },
          correlationId: CorrelationIdSchema.parse(input.correlationId),
        });
        await options.outbox?.enqueue(
          tx,
          relationshipMessageSentEvent({
            tenantId: conversation.tenantId,
            senderUserId: input.senderUserId,
            correlationId: CorrelationIdSchema.parse(input.correlationId),
            relationshipId: input.relationshipId,
            conversationId: conversation.id,
            messageId: id,
            senderSide: input.senderSide,
          }),
        );
      }
      const rows = await tx.sql<MessageRow[]>`${SELECT_MESSAGE(tx.sql)}
        where m.id = ${id}`;
      const row = rows[0];
      if (row === undefined) throw new Error("inserted message not found");
      return { row: toRow(row), deduplicated: false };
    });

  return {
    conversationFor: (relationshipId) => conversationIn(sql, relationshipId),

    append: async (input) => {
      try {
        return await insert(input);
      } catch (error) {
        // A concurrent retry with the same key won the race: answer with
        // the stored message rather than an error.
        if ((error as { code?: unknown }).code === "23505") {
          const existing = await findBySenderKey(
            sql,
            input.senderUserId,
            input.idempotencyKey,
          );
          if (existing !== null) return { row: existing, deduplicated: true };
        }
        // The block guard trigger: a block landed between the service's
        // check and this insert.
        if ((error as { code?: unknown }).code === "55000") {
          throw new ChatBlockedError();
        }
        throw error;
      }
    },

    findMessage: async (conversationId, messageId) => {
      const rows = await sql<MessageRow[]>`${SELECT_MESSAGE(sql)}
        where m.conversation_id = ${conversationId} and m.id = ${messageId}`;
      const row = rows[0];
      return row === undefined ? null : toRow(row);
    },

    findWithRevisions: async (conversationId, messageId) => {
      const rows = await sql<MessageRow[]>`${SELECT_MESSAGE(sql)}
        where m.conversation_id = ${conversationId}
          and (m.id = ${messageId} or m.revises_message_id = ${messageId})
        order by m.created_at asc, m.id asc`;
      return rows.map(toRow);
    },

    listRecent: async (conversationId, limit) => {
      const rows = await sql<MessageRow[]>`
        with originals as (
          select id from communication.messages
           where conversation_id = ${conversationId} and revises_message_id is null
           order by created_at desc, id desc
           limit ${limit}
        )
        ${SELECT_MESSAGE(sql)}
         where m.conversation_id = ${conversationId}
           and (m.id in (select id from originals)
                or m.revises_message_id in (select id from originals))
         order by m.created_at asc, m.id asc`;
      return rows.map(toRow);
    },

    listChangedAfter: async (conversationId, afterMessageId, limit) => {
      const rows = await sql<MessageRow[]>`
        with anchor as (
          select created_at, id from communication.messages
           where id = ${afterMessageId} and conversation_id = ${conversationId}
        ), changed as (
          select coalesce(m.revises_message_id, m.id) as original_id
            from communication.messages m, anchor a
           where m.conversation_id = ${conversationId}
             and (m.created_at, m.id) > (a.created_at, a.id)
           order by m.created_at asc, m.id asc
           limit ${limit}
        )
        ${SELECT_MESSAGE(sql)}
         where m.conversation_id = ${conversationId}
           and (m.id in (select original_id from changed)
                or m.revises_message_id in (select original_id from changed))
         order by m.created_at asc, m.id asc`;
      return rows.map(toRow);
    },

    latestRowId: async (conversationId) => {
      const rows = await sql<{ id: string }[]>`
        select id from communication.messages
         where conversation_id = ${conversationId}
         order by created_at desc, id desc limit 1`;
      return rows[0]?.id ?? null;
    },

    markRead: async ({ conversation, userId, side, messageId }) => {
      await sql`
        insert into communication.read_receipts
          (conversation_id, tenant_id, user_id, reader_side, last_read_message_id)
        values (${conversation.id}, ${conversation.tenantId}, ${userId}, ${side}, ${messageId})
        on conflict (conversation_id, user_id) do update
          set last_read_message_id = excluded.last_read_message_id,
              reader_side = excluded.reader_side,
              last_read_at = clock_timestamp()
          where (select (n.created_at, n.id) from communication.messages n
                  where n.id = excluded.last_read_message_id)
              > (select (o.created_at, o.id) from communication.messages o
                  where o.id = communication.read_receipts.last_read_message_id)`;
    },

    lastReadBySide: async (conversationId, side) => {
      const rows = await sql<{ id: string }[]>`
        select m.id from communication.read_receipts r
          join communication.messages m on m.id = r.last_read_message_id
         where r.conversation_id = ${conversationId} and r.reader_side = ${side}
         order by m.created_at desc, m.id desc limit 1`;
      return rows[0]?.id ?? null;
    },

    unreadCount: async (conversationId, userId, side) => {
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from communication.messages m
         where m.conversation_id = ${conversationId}
           and m.revises_message_id is null
           and m.sender_side <> ${side}
           and (m.created_at, m.id) > coalesce(
             (select (c.created_at, c.id) from communication.read_receipts r
                join communication.messages c on c.id = r.last_read_message_id
               where r.conversation_id = ${conversationId} and r.user_id = ${userId}),
             ('-infinity'::timestamptz, '00000000-0000-0000-0000-000000000000'::uuid))`;
      return rows[0]?.n ?? 0;
    },

    activeBlockSides: async (relationshipId) => {
      const rows = await sql<{ blocker_side: ChatMessageRow["senderSide"] }[]>`
        select blocker_side from communication.blocks
         where relationship_id = ${relationshipId} and lifted_at is null`;
      return rows.map((row) => row.blocker_side);
    },

    unreadForOrganisation: async (organisationId, userId) => {
      // The organisation's side on each thread comes from the canonical
      // rows; a thread where it is neither party never appears.
      const rows = await sql<{ relationship_id: string; n: number }[]>`
        with threads as (
          select c.id, c.relationship_id,
                 case when co.organisation_id = ${organisationId} then 'COMPANY' else 'INVESTOR' end as side
            from communication.conversations c
            join network.relationships r on r.id = c.relationship_id
            join core.companies co on co.id = r.company_id
            join core.investor_organisations io on io.id = r.investor_organisation_id
           where co.organisation_id = ${organisationId} or io.organisation_id = ${organisationId}
        )
        select t.relationship_id, count(m.id)::int as n
          from threads t
          join communication.messages m
            on m.conversation_id = t.id
           and m.revises_message_id is null
           and m.sender_side <> t.side
          left join communication.read_receipts rr
            on rr.conversation_id = t.id and rr.user_id = ${userId}
          left join communication.messages c on c.id = rr.last_read_message_id
         where c.id is null or (m.created_at, m.id) > (c.created_at, c.id)
         group by t.relationship_id
         limit 500`;
      return rows.map((row) => ({
        relationshipId: row.relationship_id,
        unread: row.n,
      }));
    },
  };
}
