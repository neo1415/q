import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import {
  buildRfc822,
  createGmailEmailProvider,
  createIntegrationsService,
  createTokenCipher,
  decodeGmailNotification,
  GoogleProviderError,
  MimeHeaderError,
  pkceChallenge,
  PushTokenError,
  redactProviderText,
  SecretToken,
  sha256Hex,
  TokenCipherError,
  verifyGooglePushToken,
  type GoogleHttp,
} from "@capital-q/integrations";
import {
  createFakeEmailProvider,
  createFakeGoogleOAuth,
  createInMemoryIntegrationsStore,
  createRecordingActivityWriter,
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  inlineTransactions,
} from "@capital-q/integrations/testing";
import { createLogger } from "@capital-q/observability";

const KEY = randomBytes(32).toString("base64");
const TENANT = "00000000-0000-4000-8000-00000000000a";
const INVESTOR = "00000000-0000-4000-8000-0000000000b1";
const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const CORRELATION = "cor_00000000-0000-4000-8000-000000000001";

function capturingLogger() {
  const lines: string[] = [];
  const logger = createLogger(
    { serviceName: "integrations-test", environment: "test" },
    {
      level: "debug",
      destination: {
        write: (line: string) => {
          lines.push(line);
        },
      },
    },
  );
  return { logger, lines };
}

function world(options: { readonly pushTopic?: string } = {}) {
  const store = createInMemoryIntegrationsStore();
  const activity = createRecordingActivityWriter();
  const oauth = createFakeGoogleOAuth();
  const mailbox = createFakeEmailProvider();
  const { logger, lines } = capturingLogger();
  const service = createIntegrationsService({
    store,
    transactions: inlineTransactions,
    activity,
    google: {
      oauth,
      cipher: createTokenCipher(KEY),
      email: mailbox,
      pushTopic: options.pushTopic,
    },
    logger,
  });
  return { store, activity, oauth, mailbox, service, lines };
}

async function connected(w: ReturnType<typeof world>) {
  const { authorizationUrl } = await w.service.startConnect({
    tenantId: TENANT,
    userId: INVESTOR,
  });
  const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
  const outcome = await w.service.completeConnect({
    state,
    code: "4/fake-authorization-code-0123456789",
    error: undefined,
  });
  return { state, authorizationUrl, outcome };
}

const send = (w: ReturnType<typeof world>, key = "q-action:q_action:run:1") =>
  w.service.sendApprovedEmail({
    tenantId: TENANT,
    approverUserId: INVESTOR,
    relationshipId: RELATIONSHIP,
    qActionId: "00000000-0000-4000-8000-0000000000d1",
    idempotencyKey: key,
    to: "ada@founder.example.invalid",
    toName: "Ada",
    subject: "Following up on Apex",
    body: "Hi Ada,\nCould we talk this week?",
    correlationId: CORRELATION,
  });

describe("token cipher", () => {
  it("round-trips, and a ciphertext is bound to its row", () => {
    const cipher = createTokenCipher(KEY);
    const sealed = cipher.encrypt(new SecretToken("secret"), INVESTOR);
    expect(sealed.toString("utf8")).not.toContain("secret");
    expect(cipher.decrypt(sealed, INVESTOR).reveal()).toBe("secret");
    expect(() => cipher.decrypt(sealed, TENANT)).toThrow(TokenCipherError);
    expect(() =>
      createTokenCipher(randomBytes(32).toString("base64")).decrypt(
        sealed,
        INVESTOR,
      ),
    ).toThrow(TokenCipherError);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => createTokenCipher(randomBytes(16).toString("base64"))).toThrow(
      TokenCipherError,
    );
  });
});

describe("redaction: a token never reaches a log, an error or a prompt", () => {
  it("a SecretToken cannot be stringified, serialised or inspected", () => {
    const token = new SecretToken(FAKE_REFRESH_TOKEN);
    const holder = { token };
    expect(JSON.stringify(holder)).not.toContain(FAKE_REFRESH_TOKEN);
    expect(inspect(holder)).not.toContain(FAKE_REFRESH_TOKEN);
    expect(`${String(token)}`).not.toContain(FAKE_REFRESH_TOKEN);
  });

  it("text that touched a provider is scrubbed", () => {
    const scrubbed = redactProviderText(
      `Bearer ${FAKE_ACCESS_TOKEN} refresh_token=${FAKE_REFRESH_TOKEN} {"access_token":"${FAKE_ACCESS_TOKEN}"}`,
    );
    expect(scrubbed).not.toContain(FAKE_ACCESS_TOKEN);
    expect(scrubbed).not.toContain(FAKE_REFRESH_TOKEN);
  });

  it("connect, send, sync, revoke and disconnect log no token, code, verifier or state", async () => {
    const w = world({ pushTopic: "projects/capital-q/topics/gmail-replies" });
    const { state } = await connected(w);
    await send(w);
    w.oauth.failRefresh = true;
    await w.service.pollAll(CORRELATION);
    await w.service.disconnect(INVESTOR);
    const log = w.lines.join("\n");
    expect(w.lines.length).toBeGreaterThan(0);
    for (const secret of [
      FAKE_REFRESH_TOKEN,
      FAKE_ACCESS_TOKEN,
      "4/fake-authorization-code",
      state,
      w.oauth.exchanged[0]?.verifier ?? "unreachable",
      "ada@founder.example.invalid",
      "Following up on Apex",
    ]) {
      expect(log).not.toContain(secret);
    }
    // At rest: only ciphertext.
    const sealed = w.store.accounts[0]?.refreshTokenCiphertext;
    expect(Buffer.from(sealed ?? []).toString("latin1")).not.toContain(
      FAKE_REFRESH_TOKEN,
    );
  });

  it("a provider error carries a code and a status, never the request", async () => {
    const http: GoogleHttp = () =>
      Promise.resolve({ status: 401, json: () => Promise.resolve({}) });
    const gmail = createGmailEmailProvider(http);
    const error = await gmail
      .send({ accessToken: new SecretToken(FAKE_ACCESS_TOKEN) }, "raw")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleProviderError);
    expect(inspect(error)).not.toContain(FAKE_ACCESS_TOKEN);
    expect(JSON.stringify(error)).not.toContain(FAKE_ACCESS_TOKEN);
  });
});

describe("OAuth connect (PKCE + one-time state)", () => {
  it("binds the verifier to the challenge and consumes the state once", async () => {
    const w = world();
    const { state, authorizationUrl, outcome } = await connected(w);
    expect(outcome.outcome).toBe("CONNECTED");
    const challenge = new URL(authorizationUrl).searchParams.get(
      "code_challenge",
    );
    expect(challenge).toBe(pkceChallenge(w.oauth.exchanged[0]?.verifier ?? ""));
    expect(w.store.states[0]?.stateHash).toBe(sha256Hex(state));
    const replay = await w.service.completeConnect({
      state,
      code: "4/another-code-0123456789",
      error: undefined,
    });
    expect(replay.outcome).toBe("FAILED");
    expect(await w.service.status(INVESTOR)).toMatchObject({
      status: "CONNECTED",
      email: "investor@example.invalid",
    });
  });

  it("a grant without mail scopes is handed back, not connected", async () => {
    const w = world();
    const narrow = createFakeGoogleOAuth({ scopes: ["openid", "email"] });
    const service = createIntegrationsService({
      store: w.store,
      transactions: inlineTransactions,
      activity: w.activity,
      google: {
        oauth: narrow,
        cipher: createTokenCipher(KEY),
        email: w.mailbox,
      },
    });
    const { authorizationUrl } = await service.startConnect({
      tenantId: TENANT,
      userId: INVESTOR,
    });
    const outcome = await service.completeConnect({
      state: new URL(authorizationUrl).searchParams.get("state") ?? "",
      code: "4/fake-authorization-code-0123456789",
      error: undefined,
    });
    expect(outcome.outcome).toBe("DENIED");
    expect(narrow.revoked).toEqual([FAKE_REFRESH_TOKEN]);
    expect(w.store.accounts).toHaveLength(0);
  });

  it("disconnect revokes at Google and drops the credential", async () => {
    const w = world();
    await connected(w);
    await w.service.disconnect(INVESTOR);
    expect(w.oauth.revoked).toEqual([FAKE_REFRESH_TOKEN]);
    expect(w.store.accounts[0]?.status).toBe("DISCONNECTED");
    expect(w.store.accounts[0]?.refreshTokenCiphertext).toBeNull();
    expect((await w.service.status(INVESTOR)).status).toBe("NOT_CONNECTED");
  });

  it("without configuration the integration says it is unavailable", async () => {
    const service = createIntegrationsService({
      store: createInMemoryIntegrationsStore(),
      transactions: inlineTransactions,
      activity: createRecordingActivityWriter(),
      google: undefined,
    });
    expect(await service.status(INVESTOR)).toEqual({ status: "UNAVAILABLE" });
  });
});

describe("approved send", () => {
  it("sends once per execution identity; a duplicate approve sends nothing more", async () => {
    const w = world();
    await connected(w);
    const first = await send(w);
    const second = await send(w);
    expect(first).toMatchObject({ outcome: "SENT", alreadySent: false });
    expect(second).toMatchObject({ outcome: "SENT", alreadySent: true });
    expect(w.mailbox.sent).toHaveLength(1);
    expect(w.activity.events).toEqual([
      expect.objectContaining({
        eventType: "outreach_sent",
        actorType: "HUMAN",
      }),
    ]);
    const raw = Buffer.from(
      w.mailbox.sent[0]?.raw ?? "",
      "base64url",
    ).toString();
    expect(raw).toMatch(/^Message-ID: <cq-[0-9a-f-]+@mail\.capitalq\.app>$/m);
    expect(raw).toContain('To: "Ada" <ada@founder.example.invalid>');
  });

  it("never resends a send that may have happened", async () => {
    const w = world();
    await connected(w);
    w.mailbox.failSend = new GoogleProviderError("UNAVAILABLE", null);
    expect(await send(w)).toMatchObject({ outcome: "UNKNOWN" });
    w.mailbox.failSend = null;
    expect(await send(w)).toMatchObject({ outcome: "UNKNOWN" });
    expect(w.mailbox.sent).toHaveLength(0);
    expect(w.activity.events).toHaveLength(0);
  });

  it("a definite refusal may be retried and then sends once", async () => {
    const w = world();
    await connected(w);
    w.mailbox.failSend = new GoogleProviderError("RATE_LIMITED", 429);
    expect(await send(w)).toMatchObject({ outcome: "FAILED", retryable: true });
    w.mailbox.failSend = null;
    expect(await send(w)).toMatchObject({
      outcome: "SENT",
      alreadySent: false,
    });
    expect(w.mailbox.sent).toHaveLength(1);
  });

  it("a person without a connected mailbox sends nothing", async () => {
    const w = world();
    expect(await send(w)).toEqual({ outcome: "NOT_CONNECTED" });
  });

  it("refuses a header injection", () => {
    expect(() =>
      buildRfc822({
        from: "a@example.invalid",
        to: "b@example.invalid",
        subject: "hi\r\nBcc: victim@example.invalid",
        body: "x",
        messageId: "<m@x>",
        date: new Date(),
      }),
    ).toThrow(MimeHeaderError);
  });
});

describe("reply tracking (push and poll share one idempotent sync)", () => {
  async function sentAndReplied() {
    const w = world();
    await connected(w);
    await send(w);
    const ours = w.store.emails[0];
    w.mailbox.deliver({
      providerMessageId: "reply1",
      providerThreadId: "thread-other",
      labelIds: ["INBOX", "UNREAD"],
      from: "Ada <ada@founder.example.invalid>",
      to: "investor@example.invalid",
      subject: "Re: Following up on Apex",
      messageId: "<reply1@founder.example.invalid>",
      inReplyTo: ours?.rfc822MessageId,
      references: ours?.rfc822MessageId,
      receivedAt: new Date(),
    });
    w.mailbox.deliver({
      providerMessageId: "unrelated",
      providerThreadId: "thread-x",
      labelIds: ["INBOX"],
      from: "someone@else.example.invalid",
      to: "investor@example.invalid",
      subject: "Newsletter",
      messageId: "<n@else>",
      inReplyTo: undefined,
      references: undefined,
      receivedAt: new Date(),
    });
    return w;
  }

  it("records a matched reply once, however often it is synced", async () => {
    const w = await sentAndReplied();
    const accountId = w.store.accounts[0]?.id ?? "";
    const firstPoll = await w.service.pollAll(CORRELATION);
    // Push for the same mailbox and a second poll race the first.
    const accountRow = w.store.accounts[0];
    if (accountRow !== undefined) {
      w.store.accounts[0] = { ...accountRow, historyId: "100" };
    }
    const push = await w.service.handlePush(
      { emailAddress: "INVESTOR@example.invalid" },
      CORRELATION,
    );
    const again = await w.service.syncMailbox(accountId, CORRELATION);
    expect(firstPoll.replies).toBe(1);
    expect(push).toBe(0);
    expect(again).toBe(0);
    const replies = w.activity.events.filter(
      (e) => e.eventType === "reply_received",
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.relationshipId).toBe(RELATIONSHIP);
    expect(
      w.store.emails.filter((e) => e.direction === "INBOUND"),
    ).toHaveLength(1);
    expect(
      w.store.emails.find((e) => e.direction === "INBOUND")?.bodyText,
    ).toBeNull();
  });

  it("the person's own messages are not replies", async () => {
    const w = world();
    await connected(w);
    await send(w);
    w.mailbox.deliver({
      providerMessageId: "self",
      providerThreadId: "thread1",
      labelIds: ["SENT"],
      from: "investor@example.invalid",
      to: "ada@founder.example.invalid",
      subject: "Re: Following up",
      messageId: "<self@x>",
      inReplyTo: undefined,
      references: undefined,
      receivedAt: new Date(),
    });
    await w.service.pollAll(CORRELATION);
    expect(
      w.activity.events.filter((e) => e.eventType === "reply_received"),
    ).toHaveLength(0);
  });

  it("a revoked grant ends the connection instead of failing forever", async () => {
    const w = world();
    await connected(w);
    // A fresh process: nothing cached.
    const service = createIntegrationsService({
      store: w.store,
      transactions: inlineTransactions,
      activity: w.activity,
      google: {
        oauth: w.oauth,
        cipher: createTokenCipher(KEY),
        email: w.mailbox,
      },
    });
    w.oauth.failRefresh = true;
    await service.pollAll(CORRELATION);
    expect(w.store.accounts[0]?.status).toBe("REVOKED_BY_PROVIDER");
    expect(w.store.accounts[0]?.refreshTokenCiphertext).toBeNull();
  });
});

describe("Pub/Sub push OIDC verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" } as {
    kid: string;
    kty: "RSA";
    n: string;
    e: string;
  };
  const AUDIENCE =
    "https://capital-qapi-production.up.railway.app/v1/integrations/google/gmail-push";
  const SERVICE_ACCOUNT = "gmail-push@capital-q.iam.gserviceaccount.com";
  const keys = () => Promise.resolve([jwk]);

  function token(claims: Record<string, unknown>, kid = "k1") {
    const part = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${part({ alg: "RS256", kid, typ: "JWT" })}.${part({
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      email: SERVICE_ACCOUNT,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })}`;
    return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
  }
  const verifyWith = (jwt: string) =>
    verifyGooglePushToken(jwt, {
      audience: AUDIENCE,
      serviceAccountEmail: SERVICE_ACCOUNT,
      keys,
    });
  const reason = (jwt: string) =>
    verifyWith(jwt).then(
      () => "ACCEPTED",
      (error: unknown) =>
        error instanceof PushTokenError ? error.reason : "OTHER",
    );

  it("accepts Google's token for our audience and push account", async () => {
    await expect(verifyWith(token({}))).resolves.toBeUndefined();
  });

  it("rejects a bad audience", async () => {
    expect(
      await reason(
        token({
          aud: "https://evil.example/v1/integrations/google/gmail-push",
        }),
      ),
    ).toBe("BAD_AUDIENCE");
  });

  it("rejects another service account, an unverified one, a bad issuer, an expired token", async () => {
    expect(
      await reason(token({ email: "other@capital-q.iam.gserviceaccount.com" })),
    ).toBe("BAD_SUBJECT");
    expect(await reason(token({ email_verified: false }))).toBe("BAD_SUBJECT");
    expect(await reason(token({ iss: "https://evil.example" }))).toBe(
      "BAD_ISSUER",
    );
    expect(
      await reason(token({ exp: Math.floor(Date.now() / 1000) - 600 })),
    ).toBe("EXPIRED");
  });

  it("rejects a forged signature, an unknown key and garbage", async () => {
    const good = token({});
    const [h, c] = good.split(".");
    const forgedClaims = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: AUDIENCE,
        email: SERVICE_ACCOUNT,
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 9999,
      }),
    ).toString("base64url");
    expect(c).not.toBe(forgedClaims);
    expect(
      await reason(`${h ?? ""}.${forgedClaims}.${good.split(".")[2] ?? ""}`),
    ).toBe("BAD_SIGNATURE");
    expect(await reason(token({}, "unknown"))).toBe("UNKNOWN_KEY");
    expect(await reason("not-a-jwt")).toBe("MALFORMED");
  });

  it("decodes Gmail's notification from the push envelope", () => {
    const data = Buffer.from(
      JSON.stringify({
        emailAddress: "investor@example.invalid",
        historyId: 1234,
      }),
    ).toString("base64");
    expect(
      decodeGmailNotification({ message: { data, messageId: "1" } }),
    ).toEqual({
      emailAddress: "investor@example.invalid",
      historyId: "1234",
    });
    expect(decodeGmailNotification({ message: { data: "!!" } })).toBeNull();
  });
});
