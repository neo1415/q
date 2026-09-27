import type { SecretToken } from "./secret.js";

/**
 * The EmailProvider port (BIZ-007; CLAUDE.md: provider SDKs stay behind
 * adapters). The integrations service speaks only this; Gmail is the V1
 * adapter (`./google/gmail.ts`) and tests use `./testing`'s fake.
 *
 * Access is a short-lived access token the service minted from the
 * mailbox's encrypted refresh token for this one call; the port never sees
 * a refresh token and never persists anything.
 */

export type MailboxAccess = { readonly accessToken: SecretToken };

export type SentMessage = {
  readonly providerMessageId: string;
  readonly providerThreadId: string;
};

export type InboundMetadata = {
  readonly providerMessageId: string;
  readonly providerThreadId: string;
  readonly labelIds: readonly string[];
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly subject: string | undefined;
  readonly messageId: string | undefined;
  readonly inReplyTo: string | undefined;
  readonly references: string | undefined;
  readonly receivedAt: Date;
};

export type EmailProvider = {
  /** `raw` is a complete RFC 5322 message, base64url. */
  readonly send: (access: MailboxAccess, raw: string) => Promise<SentMessage>;
  readonly currentHistoryId: (access: MailboxAccess) => Promise<string>;
  /**
   * Message ids added since `startHistoryId`, and the cursor to store.
   * Throws `HISTORY_EXPIRED` when the cursor is too old to replay.
   */
  readonly addedSince: (
    access: MailboxAccess,
    startHistoryId: string,
  ) => Promise<{
    readonly messageIds: readonly string[];
    readonly historyId: string;
  }>;
  readonly readMetadata: (
    access: MailboxAccess,
    providerMessageId: string,
  ) => Promise<InboundMetadata>;
  /** Start (or renew) push notifications to a Pub/Sub topic. */
  readonly watch: (
    access: MailboxAccess,
    topic: string,
  ) => Promise<{ readonly historyId: string; readonly expiresAt: Date }>;
};
