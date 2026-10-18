import type { TransactionContext } from "@capital-q/database";

/**
 * Persistence ports of the integrations context (BIZ-007). Named
 * operations only; every write happens inside the caller's transaction
 * where it must commit with a relationship event.
 */

export type GoogleAccountStatus =
  "CONNECTED" | "DISCONNECTED" | "REVOKED_BY_PROVIDER";

export type GoogleAccountRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly googleSubject: string;
  readonly email: string;
  readonly scopes: readonly string[];
  readonly status: GoogleAccountStatus;
  /** Sealed; opened only by the cipher, bound to `userId`. */
  readonly refreshTokenCiphertext: Uint8Array | null;
  readonly historyId: string | null;
  readonly watchExpiresAt: Date | null;
  readonly lastSyncedAt: Date | null;
  readonly connectedAt: Date;
};

export type OAuthStateRecord = {
  readonly stateHash: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly codeVerifierCiphertext: Uint8Array;
  readonly returnTo: string;
};

export type EmailDirection = "OUTBOUND" | "INBOUND";
export type EmailStatus = "SENDING" | "SENT" | "FAILED" | "RECEIVED";

export type EmailMessageRecord = {
  readonly id: string;
  readonly tenantId: string;
  readonly googleAccountId: string;
  readonly relationshipId: string;
  readonly direction: EmailDirection;
  readonly status: EmailStatus;
  readonly qActionId: string | null;
  readonly idempotencyKey: string | null;
  readonly rfc822MessageId: string;
  readonly providerMessageId: string | null;
  readonly providerThreadId: string | null;
  readonly replyToEmailId: string | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly subject: string;
  readonly occurredAt: Date;
};

export type NewOutboundEmail = {
  readonly tenantId: string;
  readonly googleAccountId: string;
  readonly relationshipId: string;
  readonly qActionId: string;
  readonly idempotencyKey: string;
  readonly rfc822MessageId: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly subject: string;
  readonly bodyText: string;
};

export type NewInboundEmail = {
  readonly tenantId: string;
  readonly googleAccountId: string;
  readonly relationshipId: string;
  readonly replyToEmailId: string;
  readonly rfc822MessageId: string;
  readonly providerMessageId: string;
  readonly providerThreadId: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly subject: string;
  readonly occurredAt: Date;
};

export type IntegrationsStore = {
  readonly saveOAuthState: (
    state: OAuthStateRecord & { readonly expiresAt: Date },
  ) => Promise<void>;
  /** One-time: consumed atomically; an expired or used state is null. */
  readonly consumeOAuthState: (
    stateHash: string,
    now: Date,
  ) => Promise<OAuthStateRecord | null>;

  /** Replaces any live connection of the same person, in one transaction. */
  readonly connectAccount: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly googleSubject: string;
    readonly email: string;
    readonly scopes: readonly string[];
    readonly refreshTokenCiphertext: Uint8Array;
    readonly keyVersion: number;
    readonly historyId: string | null;
  }) => Promise<GoogleAccountRecord>;
  readonly findConnectedByUser: (
    userId: string,
  ) => Promise<GoogleAccountRecord | null>;
  /**
   * meetfix-57: the person's newest connection, live or ended, and when it
   * ended -- so "Google ended it" reads apart from "never connected".
   */
  readonly latestStatus: (userId: string) => Promise<{
    readonly status: GoogleAccountStatus;
    readonly endedAt: Date | null;
  } | null>;
  readonly findConnectedById: (
    accountId: string,
  ) => Promise<GoogleAccountRecord | null>;
  readonly findConnectedByEmail: (
    email: string,
  ) => Promise<readonly GoogleAccountRecord[]>;
  /** Oldest-synced first, bounded. */
  readonly listConnected: (
    limit: number,
  ) => Promise<readonly GoogleAccountRecord[]>;
  /**
   * Drops the credential; the row stays as history. True only for the call
   * that ended a live connection, so what follows an ending happens once.
   */
  readonly endConnection: (
    accountId: string,
    status: "DISCONNECTED" | "REVOKED_BY_PROVIDER",
  ) => Promise<boolean>;
  /**
   * meetfix-57: the person's one notice that Google ended this connection,
   * with the reconnect link; idempotent per connection.
   */
  readonly noticeRevoked: (account: GoogleAccountRecord) => Promise<void>;
  readonly saveCursor: (
    accountId: string,
    cursor: {
      readonly historyId: string;
      readonly watchExpiresAt?: Date | undefined;
      readonly syncedAt: Date;
    },
  ) => Promise<void>;

  /**
   * Claims the one outbound row for an execution identity. `created` false
   * means a row already existed (a retry or a duplicate): its status says
   * what happened before.
   */
  readonly claimOutbound: (input: NewOutboundEmail) => Promise<{
    readonly record: EmailMessageRecord;
    readonly created: boolean;
  }>;
  /** FAILED → SENDING for a retry of a definite failure; false if not FAILED. */
  readonly reclaimFailedOutbound: (emailId: string) => Promise<boolean>;
  readonly markOutboundSent: (
    tx: TransactionContext,
    emailId: string,
    sent: {
      readonly providerMessageId: string;
      readonly providerThreadId: string;
    },
  ) => Promise<void>;
  readonly markOutboundFailed: (emailId: string) => Promise<void>;
  /** The outbound message a reply answers, by thread or by Message-ID. */
  readonly findOutboundForReply: (
    googleAccountId: string,
    match: {
      readonly providerThreadId: string;
      readonly referencedMessageIds: readonly string[];
    },
  ) => Promise<EmailMessageRecord | null>;
  /** Null when that provider message is already recorded (push/poll race). */
  readonly insertInbound: (
    tx: TransactionContext,
    input: NewInboundEmail,
  ) => Promise<EmailMessageRecord | null>;
  readonly listForRelationship: (
    googleAccountId: string,
    relationshipId: string,
  ) => Promise<readonly EmailMessageRecord[]>;
};

/** Relationship history, reached through the Network context's appender. */
export type RelationshipActivityWriter = {
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly relationshipId: string;
      readonly eventType: "outreach_sent" | "reply_received";
      readonly emailMessageId: string;
      readonly actor:
        | { readonly type: "HUMAN"; readonly id: string }
        | { readonly type: "CONNECTED_SYSTEM"; readonly id: string };
      readonly correlationId: string;
    },
  ) => Promise<void>;
};

/** A person on the other side of a relationship who may be emailed. */
export type RelationshipContact = {
  readonly name: string;
  readonly email: string;
};

export type CounterpartDirectory = {
  /**
   * The active people of the counterparty organisation. The caller has
   * already established that the actor is a party to the relationship and
   * which side they are on.
   */
  readonly contacts: (input: {
    readonly relationshipId: string;
    readonly counterpart: "COMPANY" | "INVESTOR_ORGANISATION";
  }) => Promise<readonly RelationshipContact[]>;
};
