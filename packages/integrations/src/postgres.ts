import { CorrelationIdSchema } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipEventAppender,
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
  RelationshipIdSchema,
} from "@capital-q/network";

import type {
  CounterpartDirectory,
  EmailMessageRecord,
  GoogleAccountRecord,
  IntegrationsStore,
  RelationshipActivityWriter,
} from "./store.js";

/**
 * PostgreSQL for `integrations.*` (BIZ-007), over the privileged server
 * connection: business authorization is the service's and the caller's.
 * Rows are mapped explicitly; ciphertext columns are selected only where a
 * credential must be opened. Nothing here logs.
 */

type AccountRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  google_subject: string;
  email: string;
  scopes: string[];
  status: GoogleAccountRecord["status"];
  refresh_token_ciphertext: Uint8Array | null;
  history_id: string | null;
  watch_expires_at: Date | null;
  last_synced_at: Date | null;
  connected_at: Date;
};

function toAccount(row: AccountRow): GoogleAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    googleSubject: row.google_subject,
    email: row.email,
    scopes: row.scopes,
    status: row.status,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    historyId: row.history_id,
    watchExpiresAt: row.watch_expires_at,
    lastSyncedAt: row.last_synced_at,
    connectedAt: row.connected_at,
  };
}

type EmailRow = {
  id: string;
  tenant_id: string;
  google_account_id: string;
  relationship_id: string;
  direction: EmailMessageRecord["direction"];
  status: EmailMessageRecord["status"];
  q_action_id: string | null;
  idempotency_key: string | null;
  rfc822_message_id: string;
  provider_message_id: string | null;
  provider_thread_id: string | null;
  reply_to_email_id: string | null;
  from_address: string;
  to_address: string;
  subject: string;
  occurred_at: Date;
};

function toEmail(row: EmailRow): EmailMessageRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    googleAccountId: row.google_account_id,
    relationshipId: row.relationship_id,
    direction: row.direction,
    status: row.status,
    qActionId: row.q_action_id,
    idempotencyKey: row.idempotency_key,
    rfc822MessageId: row.rfc822_message_id,
    providerMessageId: row.provider_message_id,
    providerThreadId: row.provider_thread_id,
    replyToEmailId: row.reply_to_email_id,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject,
    occurredAt: row.occurred_at,
  };
}

const ACCOUNT_COLUMNS = `id, tenant_id, user_id, google_subject, email, scopes, status,
  refresh_token_ciphertext, history_id, watch_expires_at, last_synced_at, connected_at`;
const EMAIL_COLUMNS = `id, tenant_id, google_account_id, relationship_id, direction, status,
  q_action_id, idempotency_key, rfc822_message_id, provider_message_id, provider_thread_id,
  reply_to_email_id, from_address, to_address, subject, occurred_at`;

export function createPostgresIntegrationsStore(options: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
}): IntegrationsStore {
  const { sql, transactions } = options;
  const accounts = (rows: readonly AccountRow[]) => rows.map(toAccount);
  return {
    saveOAuthState: async (state) => {
      await sql`insert into integrations.oauth_states
        (state_hash, tenant_id, user_id, provider, code_verifier_ciphertext, return_to, expires_at)
        values (${state.stateHash}, ${state.tenantId}, ${state.userId}, 'google',
                ${Buffer.from(state.codeVerifierCiphertext)}, ${state.returnTo}, ${state.expiresAt})`;
    },
    consumeOAuthState: async (stateHash, now) => {
      const rows = await sql<
        {
          state_hash: string;
          tenant_id: string;
          user_id: string;
          code_verifier_ciphertext: Uint8Array;
          return_to: string;
        }[]
      >`update integrations.oauth_states
           set consumed_at = ${now}
         where state_hash = ${stateHash}
           and consumed_at is null
           and expires_at > ${now}
        returning state_hash, tenant_id, user_id, code_verifier_ciphertext, return_to`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            stateHash: row.state_hash,
            tenantId: row.tenant_id,
            userId: row.user_id,
            codeVerifierCiphertext: row.code_verifier_ciphertext,
            returnTo: row.return_to,
          };
    },
    connectAccount: (input) =>
      transactions.run(async (tx) => {
        await tx.sql`update integrations.google_accounts
            set status = 'DISCONNECTED', refresh_token_ciphertext = null,
                disconnected_at = clock_timestamp()
          where user_id = ${input.userId} and status = 'CONNECTED'`;
        const rows = await tx.sql<
          AccountRow[]
        >`insert into integrations.google_accounts
            (tenant_id, user_id, google_subject, email, scopes, refresh_token_ciphertext, key_version, history_id)
          values (${input.tenantId}, ${input.userId}, ${input.googleSubject}, ${input.email},
                  ${[...input.scopes]}, ${Buffer.from(input.refreshTokenCiphertext)},
                  ${input.keyVersion}, ${input.historyId})
          returning ${tx.sql.unsafe(ACCOUNT_COLUMNS)}`;
        const row = rows[0];
        if (row === undefined)
          throw new Error("google account insert returned nothing");
        return toAccount(row);
      }),
    findConnectedByUser: async (userId) =>
      accounts(
        await sql<AccountRow[]>`select ${sql.unsafe(ACCOUNT_COLUMNS)}
          from integrations.google_accounts
          where user_id = ${userId} and status = 'CONNECTED' limit 1`,
      )[0] ?? null,
    findConnectedById: async (accountId) =>
      accounts(
        await sql<AccountRow[]>`select ${sql.unsafe(ACCOUNT_COLUMNS)}
          from integrations.google_accounts
          where id = ${accountId} and status = 'CONNECTED' limit 1`,
      )[0] ?? null,
    findConnectedByEmail: async (email) =>
      accounts(
        await sql<AccountRow[]>`select ${sql.unsafe(ACCOUNT_COLUMNS)}
          from integrations.google_accounts
          where lower(email) = ${email.toLowerCase()} and status = 'CONNECTED' limit 10`,
      ),
    listConnected: async (limit) =>
      accounts(
        await sql<AccountRow[]>`select ${sql.unsafe(ACCOUNT_COLUMNS)}
          from integrations.google_accounts
          where status = 'CONNECTED'
          order by last_synced_at asc nulls first
          limit ${limit}`,
      ),
    endConnection: async (accountId, status) => {
      await sql`update integrations.google_accounts
          set status = ${status}, refresh_token_ciphertext = null,
              disconnected_at = clock_timestamp(), watch_expires_at = null
        where id = ${accountId} and status = 'CONNECTED'`;
    },
    saveCursor: async (accountId, cursor) => {
      await sql`update integrations.google_accounts
          set history_id = ${cursor.historyId},
              watch_expires_at = coalesce(${cursor.watchExpiresAt ?? null}::timestamptz, watch_expires_at),
              last_synced_at = ${cursor.syncedAt}
        where id = ${accountId} and status = 'CONNECTED'`;
    },
    claimOutbound: async (input) => {
      const inserted = await sql<
        EmailRow[]
      >`insert into integrations.email_messages
          (tenant_id, google_account_id, relationship_id, direction, status, q_action_id,
           idempotency_key, rfc822_message_id, from_address, to_address, subject, body_text)
        values (${input.tenantId}, ${input.googleAccountId}, ${input.relationshipId}, 'OUTBOUND',
                'SENDING', ${input.qActionId}, ${input.idempotencyKey}, ${input.rfc822MessageId},
                ${input.fromAddress}, ${input.toAddress}, ${input.subject}, ${input.bodyText})
        on conflict do nothing
        returning ${sql.unsafe(EMAIL_COLUMNS)}`;
      if (inserted[0] !== undefined) {
        return { record: toEmail(inserted[0]), created: true };
      }
      const existing = await sql<EmailRow[]>`select ${sql.unsafe(EMAIL_COLUMNS)}
          from integrations.email_messages
         where idempotency_key = ${input.idempotencyKey} or q_action_id = ${input.qActionId}
         limit 1`;
      if (existing[0] === undefined) {
        throw new Error("outbound claim conflicted without an existing row");
      }
      return { record: toEmail(existing[0]), created: false };
    },
    reclaimFailedOutbound: async (emailId) =>
      (
        await sql`update integrations.email_messages set status = 'SENDING'
          where id = ${emailId} and status = 'FAILED' returning id`
      ).length === 1,
    markOutboundSent: async (tx, emailId, sent) => {
      await tx.sql`update integrations.email_messages
          set status = 'SENT', provider_message_id = ${sent.providerMessageId},
              provider_thread_id = ${sent.providerThreadId}, occurred_at = clock_timestamp()
        where id = ${emailId} and status = 'SENDING'`;
    },
    markOutboundFailed: async (emailId) => {
      await sql`update integrations.email_messages set status = 'FAILED'
        where id = ${emailId} and status = 'SENDING'`;
    },
    findOutboundForReply: async (googleAccountId, match) => {
      const rows = await sql<EmailRow[]>`select ${sql.unsafe(EMAIL_COLUMNS)}
          from integrations.email_messages
         where google_account_id = ${googleAccountId}
           and direction = 'OUTBOUND' and status = 'SENT'
           and (provider_thread_id = ${match.providerThreadId}
                or rfc822_message_id = any(${[...match.referencedMessageIds]}::text[]))
         order by occurred_at desc
         limit 1`;
      return rows[0] === undefined ? null : toEmail(rows[0]);
    },
    insertInbound: async (tx, input) => {
      const rows = await tx.sql<
        EmailRow[]
      >`insert into integrations.email_messages
          (tenant_id, google_account_id, relationship_id, direction, status, rfc822_message_id,
           provider_message_id, provider_thread_id, reply_to_email_id, from_address, to_address,
           subject, occurred_at)
        values (${input.tenantId}, ${input.googleAccountId}, ${input.relationshipId}, 'INBOUND',
                'RECEIVED', ${input.rfc822MessageId}, ${input.providerMessageId},
                ${input.providerThreadId}, ${input.replyToEmailId}, ${input.fromAddress},
                ${input.toAddress}, ${input.subject}, ${input.occurredAt})
        on conflict do nothing
        returning ${tx.sql.unsafe(EMAIL_COLUMNS)}`;
      return rows[0] === undefined ? null : toEmail(rows[0]);
    },
    listForRelationship: async (googleAccountId, relationshipId) =>
      (
        await sql<EmailRow[]>`select ${sql.unsafe(EMAIL_COLUMNS)}
          from integrations.email_messages
         where google_account_id = ${googleAccountId}
           and relationship_id = ${relationshipId}
         order by occurred_at desc
         limit 100`
      ).map(toEmail),
  };
}

/**
 * The people of the counterparty organisation, with their sign-in address.
 *
 * Reads identity membership and auth.users email for ONE relationship's
 * counterparty. The caller has already proved the actor is a party (the
 * Network context's relationship read, as the actor). Only active
 * memberships of active people; a revoked member is never a recipient.
 */
export function createPostgresCounterpartDirectory(options: {
  readonly sql: DatabaseExecutor;
}): CounterpartDirectory {
  const { sql } = options;
  return {
    contacts: async ({ relationshipId, counterpart }) => {
      const rows =
        counterpart === "COMPANY"
          ? await sql<{ name: string | null; email: string }[]>`
              select p.display_name as name, u.email
                from network.relationships r
                join core.companies c on c.id = r.company_id
                join identity.organisation_memberships m
                  on m.organisation_id = c.organisation_id and m.membership_status = 'active'
                join identity.user_profiles p on p.id = m.user_id and p.status = 'active'
                join auth.users u on u.id = p.auth_user_id
               where r.id = ${relationshipId} and u.email is not null
               order by m.joined_at asc
               limit 10`
          : await sql<{ name: string | null; email: string }[]>`
              select p.display_name as name, u.email
                from network.relationships r
                join core.investor_organisations io on io.id = r.investor_organisation_id
                join identity.organisation_memberships m
                  on m.organisation_id = io.organisation_id and m.membership_status = 'active'
                join identity.user_profiles p on p.id = m.user_id and p.status = 'active'
                join auth.users u on u.id = p.auth_user_id
               where r.id = ${relationshipId} and u.email is not null
               order by m.joined_at asc
               limit 10`;
      return rows.map((row) => ({
        name: row.name ?? row.email.split("@")[0] ?? row.email,
        email: row.email.toLowerCase(),
      }));
    },
  };
}

/** `outreach_sent` / `reply_received` through the Network appender. */
export function createNetworkRelationshipActivityWriter(): RelationshipActivityWriter {
  const appender = createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  });
  return {
    record: async (tx, input) => {
      await appender.append(tx, {
        relationshipId: RelationshipIdSchema.parse(input.relationshipId),
        eventType: input.eventType,
        actor: input.actor,
        source: {
          type: input.actor.type === "HUMAN" ? "Q" : "SYSTEM",
          id: input.emailMessageId,
        },
        // Both sides are parties to the email itself.
        visibilityScope: "relationship_shared",
        payload: { emailMessageId: input.emailMessageId },
        correlationId: CorrelationIdSchema.parse(input.correlationId),
      });
    },
  };
}
