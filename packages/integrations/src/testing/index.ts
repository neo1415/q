import { randomUUID } from "node:crypto";

import type {
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";

import type {
  EmailProvider,
  InboundMetadata,
  MailboxAccess,
} from "../email-provider.js";
import { GoogleProviderError } from "../google/http.js";
import type { GoogleOAuthClient } from "../google/oauth.js";
import { SecretToken } from "../secret.js";
import type {
  EmailMessageRecord,
  GoogleAccountRecord,
  IntegrationsStore,
  OAuthStateRecord,
  RelationshipActivityWriter,
} from "../store.js";

/**
 * Test doubles for the integrations context. No network: the fake Google
 * records what would have been sent and serves a scripted mailbox. Never
 * composed in production.
 */

export const FAKE_REFRESH_TOKEN = "1//fake-refresh-token-DO-NOT-LOG-0123456789";
export const FAKE_ACCESS_TOKEN = "ya29.fake-access-token-DO-NOT-LOG-0123456789";

export function createFakeGoogleOAuth(
  options: {
    readonly email?: string;
    readonly scopes?: readonly string[];
  } = {},
): GoogleOAuthClient & {
  readonly revoked: string[];
  readonly exchanged: { code: string; verifier: string }[];
  failRefresh: boolean;
} {
  const revoked: string[] = [];
  const exchanged: { code: string; verifier: string }[] = [];
  const fake = {
    revoked,
    exchanged,
    failRefresh: false,
    authorizationUrl: ({
      state,
      codeChallenge,
    }: {
      state: string;
      codeChallenge: string;
    }) =>
      `https://accounts.example.invalid/auth?state=${state}&code_challenge=${codeChallenge}`,
    exchangeCode: ({
      code,
      codeVerifier,
    }: {
      code: string;
      codeVerifier: SecretToken;
    }) => {
      exchanged.push({ code, verifier: codeVerifier.reveal() });
      return Promise.resolve({
        refreshToken: new SecretToken(FAKE_REFRESH_TOKEN),
        accessToken: new SecretToken(FAKE_ACCESS_TOKEN),
        expiresInSeconds: 3600,
        scopes: options.scopes ?? [
          "openid",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/gmail.metadata",
          "https://www.googleapis.com/auth/calendar.events",
        ],
        subject: "1234567890",
        email: options.email ?? "investor@example.invalid",
      });
    },
    refresh: (_token: SecretToken) =>
      fake.failRefresh
        ? Promise.reject(new GoogleProviderError("INVALID_GRANT", 400))
        : Promise.resolve({
            accessToken: new SecretToken(FAKE_ACCESS_TOKEN),
            expiresInSeconds: 3600,
          }),
    revoke: (token: SecretToken) => {
      revoked.push(token.reveal());
      return Promise.resolve();
    },
  };
  return fake;
}

export type FakeMailbox = EmailProvider & {
  readonly sent: { raw: string; access: string }[];
  readonly inbox: InboundMetadata[];
  historyId: number;
  failSend: GoogleProviderError | null;
  /** A message arrives in the mailbox. */
  readonly deliver: (message: InboundMetadata) => void;
};

export function createFakeEmailProvider(): FakeMailbox {
  const sent: { raw: string; access: string }[] = [];
  const inbox: InboundMetadata[] = [];
  const added: { id: string; at: number }[] = [];
  const box: Omit<FakeMailbox, "deliver"> = {
    sent,
    inbox,
    historyId: 100,
    failSend: null,
    send: (access: MailboxAccess, raw: string) => {
      if (box.failSend !== null) return Promise.reject(box.failSend);
      sent.push({ raw, access: access.accessToken.reveal() });
      box.historyId += 1;
      return Promise.resolve({
        providerMessageId: `sent${String(sent.length)}`,
        providerThreadId: `thread${String(sent.length)}`,
      });
    },
    currentHistoryId: () => Promise.resolve(String(box.historyId)),
    addedSince: (_access, start) => {
      const from = Number(start);
      return Promise.resolve({
        messageIds: added.filter((a) => a.at > from).map((a) => a.id),
        historyId: String(box.historyId),
      });
    },
    readMetadata: (_access, id) => {
      const found = inbox.find((m) => m.providerMessageId === id);
      return found === undefined
        ? Promise.reject(new GoogleProviderError("REJECTED", 404))
        : Promise.resolve(found);
    },
    watch: () =>
      Promise.resolve({
        historyId: String(box.historyId),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      }),
  };
  return Object.assign(box, {
    /** A message arrives in the mailbox. */
    deliver: (message: InboundMetadata) => {
      box.historyId += 1;
      inbox.push(message);
      added.push({ id: message.providerMessageId, at: box.historyId });
    },
  });
}

/** Runs work immediately with a context no repository here touches. */
export const inlineTransactions: TransactionManager = {
  run: (work) => work({ sql: undefined as never } satisfies TransactionContext),
};

export function createInMemoryIntegrationsStore(): IntegrationsStore & {
  readonly accounts: GoogleAccountRecord[];
  /** meetfix-57: the connections whose revocation the person was told of. */
  readonly revokedNotices: string[];
  readonly emails: (EmailMessageRecord & { bodyText: string | null })[];
  readonly states: (OAuthStateRecord & {
    expiresAt: Date;
    consumed: boolean;
  })[];
} {
  const accounts: GoogleAccountRecord[] = [];
  const emails: (EmailMessageRecord & { bodyText: string | null })[] = [];
  const states: (OAuthStateRecord & { expiresAt: Date; consumed: boolean })[] =
    [];
  const replace = <T extends { id: string }>(list: T[], next: T) => {
    const index = list.findIndex((item) => item.id === next.id);
    list[index] = next;
  };
  const live = (a: GoogleAccountRecord) => a.status === "CONNECTED";
  const ended = new Map<string, Date>();
  const revokedNotices: string[] = [];
  return {
    accounts,
    revokedNotices,
    emails,
    states,
    saveOAuthState: (state) => {
      states.push({ ...state, consumed: false });
      return Promise.resolve();
    },
    consumeOAuthState: (hash, now) => {
      const found = states.find(
        (s) => s.stateHash === hash && !s.consumed && s.expiresAt > now,
      );
      if (found === undefined) return Promise.resolve(null);
      found.consumed = true;
      return Promise.resolve(found);
    },
    connectAccount: (input) => {
      for (const a of accounts.filter(
        (x) => x.userId === input.userId && live(x),
      )) {
        replace(accounts, {
          ...a,
          status: "DISCONNECTED",
          refreshTokenCiphertext: null,
        });
      }
      const record: GoogleAccountRecord = {
        id: randomUUID(),
        tenantId: input.tenantId,
        userId: input.userId,
        googleSubject: input.googleSubject,
        email: input.email,
        scopes: input.scopes,
        status: "CONNECTED",
        refreshTokenCiphertext: input.refreshTokenCiphertext,
        historyId: input.historyId,
        watchExpiresAt: null,
        lastSyncedAt: null,
        connectedAt: new Date(),
      };
      accounts.push(record);
      return Promise.resolve(record);
    },
    findConnectedByUser: (userId) =>
      Promise.resolve(
        accounts.find((a) => a.userId === userId && live(a)) ?? null,
      ),
    latestStatus: (userId) => {
      const mine = accounts.filter((a) => a.userId === userId);
      const newest = mine.find(live) ?? mine.at(-1);
      return Promise.resolve(
        newest === undefined
          ? null
          : {
              status: newest.status,
              endedAt: live(newest) ? null : (ended.get(newest.id) ?? null),
            },
      );
    },
    findConnectedById: (id) =>
      Promise.resolve(accounts.find((a) => a.id === id && live(a)) ?? null),
    findConnectedByEmail: (email) =>
      Promise.resolve(accounts.filter((a) => a.email === email && live(a))),
    listConnected: (limit) =>
      Promise.resolve(accounts.filter(live).slice(0, limit)),
    endConnection: (id, status) => {
      const a = accounts.find((x) => x.id === id && live(x));
      if (a !== undefined) {
        replace(accounts, {
          ...a,
          status,
          refreshTokenCiphertext: null,
          watchExpiresAt: null,
        });
        ended.set(a.id, new Date());
      }
      return Promise.resolve(a !== undefined);
    },
    noticeRevoked: (account) => {
      if (!revokedNotices.includes(account.id)) revokedNotices.push(account.id);
      return Promise.resolve();
    },
    saveCursor: (id, cursor) => {
      const a = accounts.find((x) => x.id === id && live(x));
      if (a !== undefined) {
        replace(accounts, {
          ...a,
          historyId: cursor.historyId,
          watchExpiresAt: cursor.watchExpiresAt ?? a.watchExpiresAt,
          lastSyncedAt: cursor.syncedAt,
        });
      }
      return Promise.resolve();
    },
    claimOutbound: (input) => {
      const existing = emails.find(
        (e) =>
          e.idempotencyKey === input.idempotencyKey ||
          e.qActionId === input.qActionId,
      );
      if (existing !== undefined)
        return Promise.resolve({ record: existing, created: false });
      const record = {
        id: randomUUID(),
        tenantId: input.tenantId,
        googleAccountId: input.googleAccountId,
        relationshipId: input.relationshipId,
        direction: "OUTBOUND" as const,
        status: "SENDING" as const,
        qActionId: input.qActionId,
        idempotencyKey: input.idempotencyKey,
        rfc822MessageId: input.rfc822MessageId,
        providerMessageId: null,
        providerThreadId: null,
        replyToEmailId: null,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        subject: input.subject,
        occurredAt: new Date(),
        bodyText: input.bodyText,
      };
      emails.push(record);
      return Promise.resolve({ record, created: true });
    },
    reclaimFailedOutbound: (id) => {
      const e = emails.find((x) => x.id === id && x.status === "FAILED");
      if (e === undefined) return Promise.resolve(false);
      replace(emails, { ...e, status: "SENDING" });
      return Promise.resolve(true);
    },
    markOutboundSent: (_tx, id, sent) => {
      const e = emails.find((x) => x.id === id && x.status === "SENDING");
      if (e !== undefined) replace(emails, { ...e, status: "SENT", ...sent });
      return Promise.resolve();
    },
    markOutboundFailed: (id) => {
      const e = emails.find((x) => x.id === id && x.status === "SENDING");
      if (e !== undefined) replace(emails, { ...e, status: "FAILED" });
      return Promise.resolve();
    },
    findOutboundForReply: (accountId, match) =>
      Promise.resolve(
        emails.find(
          (e) =>
            e.googleAccountId === accountId &&
            e.direction === "OUTBOUND" &&
            e.status === "SENT" &&
            (e.providerThreadId === match.providerThreadId ||
              match.referencedMessageIds.includes(e.rfc822MessageId)),
        ) ?? null,
      ),
    insertInbound: (_tx, input) => {
      if (
        emails.some(
          (e) =>
            e.googleAccountId === input.googleAccountId &&
            e.providerMessageId === input.providerMessageId,
        )
      ) {
        return Promise.resolve(null);
      }
      const record = {
        id: randomUUID(),
        ...input,
        direction: "INBOUND" as const,
        status: "RECEIVED" as const,
        qActionId: null,
        idempotencyKey: null,
        bodyText: null,
      };
      emails.push(record);
      return Promise.resolve(record);
    },
    listForRelationship: (accountId, relationshipId) =>
      Promise.resolve(
        emails.filter(
          (e) =>
            e.googleAccountId === accountId &&
            e.relationshipId === relationshipId,
        ),
      ),
  };
}

export function createRecordingActivityWriter(): RelationshipActivityWriter & {
  readonly events: {
    relationshipId: string;
    eventType: string;
    emailMessageId: string;
    actorType: string;
  }[];
} {
  const events: {
    relationshipId: string;
    eventType: string;
    emailMessageId: string;
    actorType: string;
  }[] = [];
  return {
    events,
    record: (_tx, input) => {
      events.push({
        relationshipId: input.relationshipId,
        eventType: input.eventType,
        emailMessageId: input.emailMessageId,
        actorType: input.actor.type,
      });
      return Promise.resolve();
    },
  };
}
