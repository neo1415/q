import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createIntegrationsService,
  createTokenCipher,
} from "@capital-q/integrations";
import {
  createFakeEmailProvider,
  createFakeGoogleOAuth,
  createInMemoryIntegrationsStore,
  createRecordingActivityWriter,
  inlineTransactions,
} from "@capital-q/integrations/testing";

import {
  GMAIL_POLL_INTERVAL_MS,
  runGmailReplyPoller,
} from "../src/integrations/gmail-poller.js";

/**
 * The 5-minute Gmail reply poller (BIZ-007): it keeps ticking through
 * failures, and ticking again over the same mailbox records a reply once.
 */

const logger = { info: () => undefined, warn: () => undefined };

describe("gmail reply poller", () => {
  it("polls every five minutes and survives a failed tick", async () => {
    const controller = new AbortController();
    let calls = 0;
    const waits: number[] = [];
    await runGmailReplyPoller({
      integrations: {
        pollAll: () => {
          calls += 1;
          return calls === 1
            ? Promise.reject(new Error("provider down"))
            : Promise.resolve({ mailboxes: 1, replies: 0 });
        },
      },
      signal: controller.signal,
      logger,
      sleep: (ms) => {
        waits.push(ms);
        if (waits.length === 3) controller.abort();
        return Promise.resolve();
      },
    });
    expect(calls).toBe(3);
    expect(waits.every((ms) => ms === GMAIL_POLL_INTERVAL_MS)).toBe(true);
  });

  it("is idempotent: repeated polls record one reply per message", async () => {
    const store = createInMemoryIntegrationsStore();
    const activity = createRecordingActivityWriter();
    const mailbox = createFakeEmailProvider();
    const integrations = createIntegrationsService({
      store,
      transactions: inlineTransactions,
      activity,
      google: {
        oauth: createFakeGoogleOAuth(),
        cipher: createTokenCipher(randomBytes(32).toString("base64")),
        email: mailbox,
      },
    });
    const { authorizationUrl } = await integrations.startConnect({
      tenantId: "00000000-0000-4000-8000-00000000000a",
      userId: "00000000-0000-4000-8000-0000000000b1",
    });
    await integrations.completeConnect({
      state: new URL(authorizationUrl).searchParams.get("state") ?? "",
      code: "4/code-0123456789abcdef",
      error: undefined,
    });
    await integrations.sendApprovedEmail({
      tenantId: "00000000-0000-4000-8000-00000000000a",
      approverUserId: "00000000-0000-4000-8000-0000000000b1",
      relationshipId: "00000000-0000-4000-8000-0000000000c1",
      qActionId: "00000000-0000-4000-8000-0000000000d1",
      idempotencyKey: "q-action:q_action:run:1",
      to: "ada@founder.example.invalid",
      toName: "Ada",
      subject: "Hello",
      body: "Hi Ada",
      correlationId: "cor_00000000-0000-4000-8000-000000000001",
    });
    mailbox.deliver({
      providerMessageId: "reply1",
      providerThreadId: "thread1",
      labelIds: ["INBOX"],
      from: "Ada <ada@founder.example.invalid>",
      to: "investor@example.invalid",
      subject: "Re: Hello",
      messageId: "<r1@founder.example.invalid>",
      inReplyTo: undefined,
      references: undefined,
      receivedAt: new Date(),
    });
    const controller = new AbortController();
    let ticks = 0;
    await runGmailReplyPoller({
      integrations,
      signal: controller.signal,
      logger,
      sleep: () => {
        ticks += 1;
        // A cursor reset stands for a crash between recording and saving it.
        const account = store.accounts[0];
        if (account !== undefined)
          store.accounts[0] = { ...account, historyId: "100" };
        if (ticks === 3) controller.abort();
        return Promise.resolve();
      },
    });
    expect(
      activity.events.filter((e) => e.eventType === "reply_received"),
    ).toHaveLength(1);
  });
});
