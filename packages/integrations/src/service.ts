import type {
  GoogleConnectionDto,
  RelationshipMailItem,
} from "@capital-q/contracts";
import type { TransactionManager } from "@capital-q/database";
import { createCorrelationId, type Logger } from "@capital-q/observability";

import {
  pkceChallenge,
  randomUrlToken,
  sha256Hex,
  type TokenCipher,
} from "./crypto.js";
import type { EmailProvider, MailboxAccess } from "./email-provider.js";
import type {
  CalendarEventInput,
  CalendarProvider,
} from "./google/calendar.js";
import { GoogleProviderError } from "./google/http.js";
import { hasRequiredScopes, type GoogleOAuthClient } from "./google/oauth.js";
import {
  addressOf,
  buildRfc822,
  newMessageId,
  referencedMessageIds,
  toBase64Url,
} from "./mime.js";
import { SecretToken } from "./secret.js";
import type {
  GoogleAccountRecord,
  IntegrationsStore,
  RelationshipActivityWriter,
} from "./store.js";

/**
 * The integrations service (BIZ-007).
 *
 *   connect      start: state + PKCE, verifier sealed; callback: state is
 *                consumed once, code exchanged, refresh token sealed
 *   disconnect   revoke at Google (best effort), then drop the credential
 *   send         only for an approved `email.send`, exactly once per
 *                execution identity; `outreach_sent` commits with SENT
 *   replies      Gmail history since the stored cursor (push or poll): a
 *                new inbound message on our thread, or naming our
 *                Message-ID, becomes one inbound row and one
 *                `reply_received`, idempotently
 *
 * No transaction is held across a Google call. Nothing here logs a token,
 * a code, a verifier, a state, an address or a subject: identifiers and
 * outcome codes only.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Renew a Gmail watch when it has less than a day left (they last 7). */
const WATCH_RENEW_MS = 24 * 60 * 60 * 1000;

export type IntegrationsServiceDependencies = {
  readonly store: IntegrationsStore;
  readonly transactions: TransactionManager;
  readonly activity: RelationshipActivityWriter;
  /** Absent: the integration is unconfigured and says so. */
  readonly google:
    | {
        readonly oauth: GoogleOAuthClient;
        readonly cipher: TokenCipher;
        readonly email: EmailProvider;
        /** BIZ-008: Calendar on the same connection (calendar.events). */
        readonly calendar?: CalendarProvider | undefined;
        /** Pub/Sub topic for Gmail push; absent means poll only. */
        readonly pushTopic?: string | undefined;
      }
    | undefined;
  readonly logger?: Logger | undefined;
  readonly now?: (() => Date) | undefined;
};

export type SendApprovedEmailCommand = {
  readonly tenantId: string;
  readonly approverUserId: string;
  readonly relationshipId: string;
  readonly qActionId: string;
  readonly idempotencyKey: string;
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly body: string;
  readonly correlationId: string;
};

export type SendApprovedEmailOutcome =
  | {
      readonly outcome: "SENT";
      readonly emailMessageId: string;
      readonly alreadySent: boolean;
    }
  | { readonly outcome: "NOT_CONNECTED" }
  | {
      readonly outcome: "FAILED";
      readonly retryable: boolean;
      readonly code: string;
    }
  | { readonly outcome: "UNKNOWN"; readonly code: string };

export type CompleteConnectOutcome = {
  readonly outcome: "CONNECTED" | "DENIED" | "FAILED";
  readonly returnTo: string;
};

export type IntegrationsService = {
  readonly available: boolean;
  readonly status: (userId: string) => Promise<GoogleConnectionDto>;
  readonly startConnect: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly returnTo?: string | undefined;
  }) => Promise<{ readonly authorizationUrl: string }>;
  readonly completeConnect: (input: {
    readonly state: string | undefined;
    readonly code: string | undefined;
    readonly error: string | undefined;
  }) => Promise<CompleteConnectOutcome>;
  readonly disconnect: (userId: string) => Promise<void>;
  readonly mailboxOf: (
    userId: string,
  ) => Promise<{ readonly email: string } | null>;
  /**
   * The person's own calendar, or null when Google is not configured, they
   * have not connected, or their grant lacks `calendar.events`.
   */
  readonly calendarOf: (userId: string) => Promise<ConnectedCalendar | null>;
  /**
   * meetfix-57: why there is no calendar, from the rows alone (no Google
   * call, nothing logged), so a booking that can't happen says the real
   * reason and a parked one can check for a reconnect cheaply.
   */
  readonly calendarState: (userId: string) => Promise<CalendarState>;
  readonly sendApprovedEmail: (
    command: SendApprovedEmailCommand,
  ) => Promise<SendApprovedEmailOutcome>;
  /** Sync one mailbox's history; returns the replies newly recorded. */
  readonly syncMailbox: (
    accountId: string,
    correlationId: string,
  ) => Promise<number>;
  /** A verified Gmail push: sync every live mailbox with that address. */
  readonly handlePush: (
    notification: { readonly emailAddress: string },
    correlationId: string,
  ) => Promise<number>;
  /** The poller's tick: renew watches, sync every live mailbox. */
  readonly pollAll: (
    correlationId: string,
    limit?: number,
  ) => Promise<{ readonly mailboxes: number; readonly replies: number }>;
  readonly listRelationshipMail: (
    userId: string,
    relationshipId: string,
  ) => Promise<readonly RelationshipMailItem[]>;
};

/**
 * One person's connected Google Calendar (BIZ-008), bound to their own
 * connection. Each call mints (or reuses) a short-lived access token from
 * the sealed refresh token; nothing here returns a token.
 */
export type ConnectedCalendar = {
  readonly email: string;
  readonly busy: (window: {
    readonly from: Date;
    readonly to: Date;
  }) => Promise<readonly { readonly start: Date; readonly end: Date }[]>;
  readonly timeZone: () => Promise<string>;
  readonly insert: (
    event: CalendarEventInput,
  ) => Promise<{ readonly meetLink: string | null }>;
  readonly move: (
    eventId: string,
    times: {
      readonly start: Date;
      readonly end: Date;
      readonly timeZone: string;
    },
  ) => Promise<void>;
  readonly cancel: (eventId: string) => Promise<void>;
  readonly conference: (
    eventId: string,
    options: { readonly ask: boolean },
  ) => Promise<
    | { readonly status: "READY"; readonly meetLink: string }
    | { readonly status: "PENDING" | "MISSING" }
  >;
  readonly announceLink: (eventId: string, meetLink: string) => Promise<void>;
};

/** A person's Google Calendar, as booking sees it. */
export type CalendarState = "CONNECTED" | "NOT_CONNECTED" | "REVOKED";

export const CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";

export class IntegrationUnavailableError extends Error {
  constructor() {
    super("the Google integration is not configured");
    this.name = "IntegrationUnavailableError";
  }
}

const SAFE_RETURN = /^\/[A-Za-z0-9/_-]{0,200}$/;

export function createIntegrationsService(
  dependencies: IntegrationsServiceDependencies,
): IntegrationsService {
  const { store, transactions, activity, google, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const accessCache = new Map<string, { token: SecretToken; until: number }>();

  function requireGoogle() {
    if (google === undefined) throw new IntegrationUnavailableError();
    return google;
  }

  async function accessFor(
    account: GoogleAccountRecord,
  ): Promise<MailboxAccess> {
    const g = requireGoogle();
    const cached = accessCache.get(account.id);
    if (cached !== undefined && cached.until > now().getTime()) {
      return { accessToken: cached.token };
    }
    if (account.refreshTokenCiphertext === null) {
      throw new GoogleProviderError("INVALID_GRANT", null);
    }
    const refreshToken = g.cipher.decrypt(
      account.refreshTokenCiphertext,
      account.userId,
    );
    try {
      const minted = await g.oauth.refresh(refreshToken);
      accessCache.set(account.id, {
        token: minted.accessToken,
        // A minute early, so a token never expires mid-request.
        until: now().getTime() + (minted.expiresInSeconds - 60) * 1000,
      });
      return { accessToken: minted.accessToken };
    } catch (error: unknown) {
      if (
        error instanceof GoogleProviderError &&
        error.code === "INVALID_GRANT"
      ) {
        // The person revoked us at Google: the credential is dead weight.
        await store.endConnection(account.id, "REVOKED_BY_PROVIDER");
        accessCache.delete(account.id);
        logger?.warn(
          { googleAccountId: account.id },
          "google grant revoked by provider; connection ended",
        );
      }
      throw error;
    }
  }

  async function syncAccount(
    account: GoogleAccountRecord,
    correlationId: string,
  ): Promise<number> {
    const g = requireGoogle();
    const access = await accessFor(account);
    const syncedAt = now();
    if (account.historyId === null) {
      // First sync: start the cursor now; earlier mail is not ours to read.
      await store.saveCursor(account.id, {
        historyId: await g.email.currentHistoryId(access),
        syncedAt,
      });
      return 0;
    }
    let added: { messageIds: readonly string[]; historyId: string };
    try {
      added = await g.email.addedSince(access, account.historyId);
    } catch (error: unknown) {
      if (
        error instanceof GoogleProviderError &&
        error.code === "HISTORY_EXPIRED"
      ) {
        // Too old to replay (a week idle). Restart the cursor; say so.
        logger?.warn(
          { googleAccountId: account.id },
          "gmail history cursor expired; restarted",
        );
        await store.saveCursor(account.id, {
          historyId: await g.email.currentHistoryId(access),
          syncedAt,
        });
        return 0;
      }
      throw error;
    }
    let recorded = 0;
    for (const providerMessageId of added.messageIds) {
      let meta: Awaited<ReturnType<EmailProvider["readMetadata"]>>;
      try {
        meta = await g.email.readMetadata(access, providerMessageId);
      } catch (error: unknown) {
        // Deleted between the history and the read: nothing to match.
        if (error instanceof GoogleProviderError && error.status === 404) {
          continue;
        }
        throw error;
      }
      const from = addressOf(meta.from);
      // Our own sends and drafts are not replies.
      if (
        from === undefined ||
        from === account.email.toLowerCase() ||
        meta.labelIds.includes("SENT") ||
        meta.labelIds.includes("DRAFT")
      ) {
        continue;
      }
      const original = await store.findOutboundForReply(account.id, {
        providerThreadId: meta.providerThreadId,
        referencedMessageIds: referencedMessageIds(
          meta.inReplyTo,
          meta.references,
        ),
      });
      if (original === null) continue;
      const inserted = await transactions.run(async (tx) => {
        const row = await store.insertInbound(tx, {
          tenantId: account.tenantId,
          googleAccountId: account.id,
          relationshipId: original.relationshipId,
          replyToEmailId: original.id,
          rfc822MessageId:
            meta.messageId ??
            `<gmail-${meta.providerMessageId}@mail.gmail.com>`,
          providerMessageId: meta.providerMessageId,
          providerThreadId: meta.providerThreadId,
          fromAddress: from,
          toAddress: addressOf(meta.to) ?? account.email,
          subject: (meta.subject ?? "").slice(0, 998),
          occurredAt: meta.receivedAt,
        });
        if (row === null) return false;
        await activity.record(tx, {
          relationshipId: original.relationshipId,
          eventType: "reply_received",
          emailMessageId: row.id,
          actor: { type: "CONNECTED_SYSTEM", id: account.id },
          correlationId,
        });
        return true;
      });
      if (inserted) recorded += 1;
    }
    await store.saveCursor(account.id, {
      historyId: added.historyId,
      syncedAt,
    });
    return recorded;
  }

  async function ensureWatch(account: GoogleAccountRecord): Promise<void> {
    const g = requireGoogle();
    if (g.pushTopic === undefined) return;
    if (
      account.watchExpiresAt !== null &&
      account.watchExpiresAt.getTime() - now().getTime() > WATCH_RENEW_MS
    ) {
      return;
    }
    const watched = await g.email.watch(await accessFor(account), g.pushTopic);
    await store.saveCursor(account.id, {
      // Keep the replay cursor where it is; only a first watch seeds it.
      historyId: account.historyId ?? watched.historyId,
      watchExpiresAt: watched.expiresAt,
      syncedAt: account.lastSyncedAt ?? now(),
    });
  }

  return {
    available: google !== undefined,

    status: async (userId) => {
      if (google === undefined) return { status: "UNAVAILABLE" };
      const account = await store.findConnectedByUser(userId);
      if (account === null) {
        // Google ended the newest connection: say so, so Settings offers
        // Reconnect rather than a first-time Connect.
        const latest = await store.latestStatus(userId);
        return latest?.status === "REVOKED_BY_PROVIDER"
          ? {
              status: "REVOKED",
              ...(latest.endedAt === null
                ? {}
                : { revokedAt: latest.endedAt.toISOString() }),
            }
          : { status: "NOT_CONNECTED" };
      }
      return {
        status: "CONNECTED",
        email: account.email,
        connectedAt: account.connectedAt.toISOString(),
        replyTracking:
          google.pushTopic === undefined ? "POLL" : "PUSH_AND_POLL",
      };
    },

    startConnect: async ({ tenantId, userId, returnTo }) => {
      const g = requireGoogle();
      const state = randomUrlToken();
      const verifier = randomUrlToken(48);
      const stateHash = sha256Hex(state);
      await store.saveOAuthState({
        stateHash,
        tenantId,
        userId,
        codeVerifierCiphertext: g.cipher.encrypt(
          new SecretToken(verifier),
          stateHash,
        ),
        returnTo:
          returnTo !== undefined && SAFE_RETURN.test(returnTo)
            ? returnTo
            : "/settings",
        expiresAt: new Date(now().getTime() + OAUTH_STATE_TTL_MS),
      });
      return {
        authorizationUrl: g.oauth.authorizationUrl({
          state,
          codeChallenge: pkceChallenge(verifier),
        }),
      };
    },

    completeConnect: async ({ state, code, error }) => {
      const g = requireGoogle();
      if (state === undefined || !/^[\w-]{20,128}$/.test(state)) {
        return { outcome: "FAILED", returnTo: "/settings" };
      }
      const stateHash = sha256Hex(state);
      // Consumed before anything else: a replayed callback finds nothing.
      const saved = await store.consumeOAuthState(stateHash, now());
      if (saved === null) return { outcome: "FAILED", returnTo: "/settings" };
      if (error !== undefined || code === undefined) {
        return { outcome: "DENIED", returnTo: saved.returnTo };
      }
      try {
        const grant = await g.oauth.exchangeCode({
          code,
          codeVerifier: g.cipher.decrypt(
            saved.codeVerifierCiphertext,
            stateHash,
          ),
        });
        if (!hasRequiredScopes(grant.scopes)) {
          // The person unticked mail access on Google's screen: nothing
          // useful is connected, and the grant is handed back.
          await g.oauth.revoke(grant.refreshToken).catch(() => undefined);
          return { outcome: "DENIED", returnTo: saved.returnTo };
        }
        const account = await store.connectAccount({
          tenantId: saved.tenantId,
          userId: saved.userId,
          googleSubject: grant.subject,
          email: grant.email,
          scopes: grant.scopes,
          refreshTokenCiphertext: g.cipher.encrypt(
            grant.refreshToken,
            saved.userId,
          ),
          keyVersion: g.cipher.keyVersion,
          historyId: null,
        });
        accessCache.set(account.id, {
          token: grant.accessToken,
          until: now().getTime() + (grant.expiresInSeconds - 60) * 1000,
        });
        // Reply tracking starts now; a failure here is recovered by the poller.
        try {
          await ensureWatch(account);
          const fresh = await store.findConnectedById(account.id);
          if (fresh !== null && fresh.historyId === null) {
            await syncAccount(fresh, createCorrelationId());
          }
        } catch (watchError: unknown) {
          logger?.warn(
            {
              googleAccountId: account.id,
              errorCode:
                watchError instanceof GoogleProviderError
                  ? watchError.code
                  : "ERROR",
            },
            "gmail watch not started at connect; the poller will retry",
          );
        }
        logger?.info(
          { googleAccountId: account.id },
          "google mailbox connected",
        );
        return { outcome: "CONNECTED", returnTo: saved.returnTo };
      } catch (exchangeError: unknown) {
        logger?.warn(
          {
            errorCode:
              exchangeError instanceof GoogleProviderError
                ? exchangeError.code
                : "ERROR",
          },
          "google connect failed",
        );
        return { outcome: "FAILED", returnTo: saved.returnTo };
      }
    },

    disconnect: async (userId) => {
      const g = requireGoogle();
      const account = await store.findConnectedByUser(userId);
      if (account === null) return;
      if (account.refreshTokenCiphertext !== null) {
        try {
          await g.oauth.revoke(
            g.cipher.decrypt(account.refreshTokenCiphertext, account.userId),
          );
        } catch (error: unknown) {
          // Revocation is best effort; forgetting the credential is not.
          logger?.warn(
            {
              googleAccountId: account.id,
              errorCode:
                error instanceof GoogleProviderError ? error.code : "ERROR",
            },
            "google revoke failed; credential dropped anyway",
          );
        }
      }
      await store.endConnection(account.id, "DISCONNECTED");
      accessCache.delete(account.id);
      logger?.info(
        { googleAccountId: account.id },
        "google mailbox disconnected",
      );
    },

    mailboxOf: async (userId) => {
      if (google === undefined) return null;
      const account = await store.findConnectedByUser(userId);
      return account === null ? null : { email: account.email };
    },

    calendarOf: async (userId) => {
      const calendar = google?.calendar;
      if (calendar === undefined) return null;
      const account = await store.findConnectedByUser(userId);
      if (account === null || !account.scopes.includes(CALENDAR_EVENTS_SCOPE)) {
        return null;
      }
      return {
        email: account.email,
        busy: async (window) => calendar.busy(await accessFor(account), window),
        timeZone: async () => calendar.timeZone(await accessFor(account)),
        insert: async (event) =>
          calendar.insert(await accessFor(account), event),
        move: async (eventId, times) =>
          calendar.move(await accessFor(account), eventId, times),
        cancel: async (eventId) =>
          calendar.cancel(await accessFor(account), eventId),
        conference: async (eventId, options) =>
          calendar.conference(await accessFor(account), eventId, options),
        announceLink: async (eventId, meetLink) =>
          calendar.announceLink(await accessFor(account), eventId, meetLink),
      };
    },

    calendarState: async (userId) => {
      if (google?.calendar === undefined) return "NOT_CONNECTED";
      const account = await store.findConnectedByUser(userId);
      if (account !== null) {
        return account.scopes.includes(CALENDAR_EVENTS_SCOPE)
          ? "CONNECTED"
          : "NOT_CONNECTED";
      }
      const latest = await store.latestStatus(userId);
      return latest?.status === "REVOKED_BY_PROVIDER"
        ? "REVOKED"
        : "NOT_CONNECTED";
    },

    sendApprovedEmail: async (command) => {
      const g = requireGoogle();
      const account = await store.findConnectedByUser(command.approverUserId);
      if (account === null) return { outcome: "NOT_CONNECTED" };
      const messageId = newMessageId();
      const claim = await store.claimOutbound({
        tenantId: account.tenantId,
        googleAccountId: account.id,
        relationshipId: command.relationshipId,
        qActionId: command.qActionId,
        idempotencyKey: command.idempotencyKey,
        rfc822MessageId: messageId,
        fromAddress: account.email,
        toAddress: command.to,
        subject: command.subject,
        bodyText: command.body,
      });
      if (!claim.created) {
        if (claim.record.status === "SENT") {
          // A duplicate approve or a retried execution: sent once, already.
          return {
            outcome: "SENT",
            emailMessageId: claim.record.id,
            alreadySent: true,
          };
        }
        if (claim.record.status === "SENDING") {
          // A previous attempt may have reached Gmail. Never resend blind.
          return { outcome: "UNKNOWN", code: "SEND_IN_DOUBT" };
        }
        if (!(await store.reclaimFailedOutbound(claim.record.id))) {
          return { outcome: "UNKNOWN", code: "SEND_IN_DOUBT" };
        }
      }
      const record = claim.record;
      let sent: { providerMessageId: string; providerThreadId: string };
      try {
        const raw = buildRfc822({
          from: account.email,
          to: command.to,
          toName: command.toName,
          subject: command.subject,
          body: command.body,
          messageId: record.rfc822MessageId,
          date: now(),
        });
        sent = await g.email.send(await accessFor(account), toBase64Url(raw));
      } catch (error: unknown) {
        const providerError =
          error instanceof GoogleProviderError ? error : null;
        // No response at all may still have been a send.
        if (
          providerError?.code === "UNAVAILABLE" &&
          providerError.status === null
        ) {
          logger?.warn(
            { emailMessageId: record.id },
            "gmail send outcome unknown",
          );
          return { outcome: "UNKNOWN", code: "SEND_IN_DOUBT" };
        }
        await store.markOutboundFailed(record.id);
        logger?.warn(
          {
            emailMessageId: record.id,
            errorCode: providerError?.code ?? "ERROR",
          },
          "gmail send failed",
        );
        return {
          outcome: "FAILED",
          retryable: providerError?.retryable ?? false,
          code:
            providerError?.code === "INVALID_GRANT"
              ? "MAILBOX_DISCONNECTED"
              : `GMAIL_${providerError?.code ?? "ERROR"}`,
        };
      }
      await transactions.run(async (tx) => {
        await store.markOutboundSent(tx, record.id, sent);
        await activity.record(tx, {
          relationshipId: command.relationshipId,
          eventType: "outreach_sent",
          emailMessageId: record.id,
          actor: { type: "HUMAN", id: command.approverUserId },
          correlationId: command.correlationId,
        });
      });
      logger?.info({ emailMessageId: record.id }, "approved email sent");
      return { outcome: "SENT", emailMessageId: record.id, alreadySent: false };
    },

    syncMailbox: async (accountId, correlationId) => {
      const account = await store.findConnectedById(accountId);
      return account === null ? 0 : syncAccount(account, correlationId);
    },

    handlePush: async (notification, correlationId) => {
      let replies = 0;
      for (const account of await store.findConnectedByEmail(
        notification.emailAddress.toLowerCase(),
      )) {
        replies += await syncAccount(account, correlationId);
      }
      return replies;
    },

    pollAll: async (correlationId, limit = 200) => {
      if (google === undefined) return { mailboxes: 0, replies: 0 };
      const accounts = await store.listConnected(limit);
      let replies = 0;
      for (const account of accounts) {
        try {
          await ensureWatch(account);
          const fresh = (await store.findConnectedById(account.id)) ?? account;
          replies += await syncAccount(fresh, correlationId);
        } catch (error: unknown) {
          // One mailbox never stops the others.
          logger?.warn(
            {
              googleAccountId: account.id,
              errorCode:
                error instanceof GoogleProviderError ? error.code : "ERROR",
            },
            "gmail mailbox sync failed",
          );
        }
      }
      return { mailboxes: accounts.length, replies };
    },

    listRelationshipMail: async (userId, relationshipId) => {
      const account = await store.findConnectedByUser(userId);
      if (account === null) return [];
      return (await store.listForRelationship(account.id, relationshipId)).map(
        (row) => ({
          id: row.id,
          direction: row.direction,
          status: row.status,
          from: row.fromAddress,
          to: row.toAddress,
          subject: row.subject,
          occurredAt: row.occurredAt.toISOString(),
        }),
      );
    },
  };
}
