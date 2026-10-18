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
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  inlineTransactions,
} from "@capital-q/integrations/testing";
import type { ActorContext } from "@capital-q/security";

import {
  createEmailActionBoard,
  createEmailSendAction,
  EMAIL_SEND,
  EmailSendPayloadSchema,
  type EmailSendPayload,
  type RelationshipCounterparts,
} from "../src/composition/email-action.js";

/**
 * email.send (BIZ-007) as the Approval Engine sees it: authorize is the
 * recipient and party rule at every stage, revisable allows the words
 * only, and the executor sends once per execution identity.
 */

const RELATIONSHIP = "00000000-0000-4000-8000-0000000000c1";
const actor = {
  actorType: "HUMAN",
  tenantId: "00000000-0000-4000-8000-00000000000a",
  userId: "00000000-0000-4000-8000-0000000000b1",
  organisationId: "00000000-0000-4000-8000-0000000000b2",
} as unknown as ActorContext;

const counterparts: RelationshipCounterparts = {
  of: (who, relationshipId) =>
    Promise.resolve(
      who.userId === actor.userId && relationshipId === RELATIONSHIP
        ? {
            kind: "COMPANY" as const,
            id: "00000000-0000-4000-8000-0000000000d1",
            name: "Apex",
            contacts: [{ name: "Ada", email: "ada@founder.example.invalid" }],
          }
        : null,
    ),
};

const payload: EmailSendPayload = {
  relationshipId: RELATIONSHIP,
  to: "ada@founder.example.invalid",
  toName: "Ada",
  counterpartName: "Apex",
  subject: "Following up on Apex",
  body: "Hi Ada, could we talk this week? Best, Ben",
};

async function world(connect = true) {
  const mailbox = createFakeEmailProvider();
  const oauth = createFakeGoogleOAuth();
  const store = createInMemoryIntegrationsStore();
  const integrations = createIntegrationsService({
    store,
    transactions: inlineTransactions,
    activity: createRecordingActivityWriter(),
    google: {
      oauth,
      cipher: createTokenCipher(randomBytes(32).toString("base64")),
      email: mailbox,
    },
  });
  if (connect) {
    const { authorizationUrl } = await integrations.startConnect({
      tenantId: actor.tenantId,
      userId: actor.userId,
    });
    await integrations.completeConnect({
      state: new URL(authorizationUrl).searchParams.get("state") ?? "",
      code: "4/code-0123456789abcdef",
      error: undefined,
    });
  }
  const action = createEmailSendAction({ integrations, counterparts });
  return { action, mailbox };
}

const approved = (idempotencyKey: string) => ({
  actionId: "00000000-0000-4000-8000-0000000000e1",
  runId: "00000000-0000-4000-8000-0000000000e2",
  tenantId: actor.tenantId,
  organisationId: actor.organisationId,
  actionType: EMAIL_SEND,
  actionVersion: 1,
  targets: [],
  payload,
  idempotencyKey,
  payloadHash: "sha256:x",
  approvalId: "00000000-0000-4000-8000-0000000000e3",
  approvedByUserId: actor.userId,
});

describe("email.send", () => {
  it("allows only a recipient on the relationship, from a party with a connected mailbox", async () => {
    const { action } = await world();
    expect(await action.authorize(payload, actor)).toEqual({
      outcome: "ALLOW",
    });
    expect(
      await action.authorize(
        { ...payload, to: "someone@elsewhere.example.invalid" },
        actor,
      ),
    ).toEqual({ outcome: "DENY", code: "RECIPIENT_NOT_ON_RELATIONSHIP" });
    expect(
      await action.authorize(
        { ...payload, relationshipId: "00000000-0000-4000-8000-0000000000ff" },
        actor,
      ),
    ).toEqual({ outcome: "DENY", code: "NOT_A_PARTY" });
    const disconnected = await world(false);
    expect(await disconnected.action.authorize(payload, actor)).toEqual({
      outcome: "DENY",
      code: "MAILBOX_NOT_CONNECTED",
    });
  });

  it("lets the person change the words, never the recipient or relationship", async () => {
    const { action } = await world();
    const revisable = action.revisable;
    expect(revisable).toBeDefined();
    expect(revisable?.(payload, { ...payload, body: "Hello Ada, ..." })).toBe(
      true,
    );
    expect(
      revisable?.(payload, { ...payload, to: "ada2@founder.example.invalid" }),
    ).toBe(false);
    expect(
      revisable?.(payload, {
        ...payload,
        relationshipId: "00000000-0000-4000-8000-0000000000ff",
      }),
    ).toBe(false);
  });

  it("executes once per execution identity: a duplicate approve sends once", async () => {
    const { action, mailbox } = await world();
    const context = {
      approver: actor,
      correlationId: "cor_00000000-0000-4000-8000-000000000001",
      attempt: 1,
    } as Parameters<typeof action.executor.execute>[1];
    const first = await action.executor.execute(
      approved("q_action:r:a") as never,
      context,
    );
    const second = await action.executor.execute(
      approved("q_action:r:a") as never,
      {
        ...context,
        attempt: 2,
      },
    );
    expect(first).toMatchObject({
      outcome: "EXECUTED",
      result: { alreadySent: false },
    });
    expect(second).toMatchObject({
      outcome: "EXECUTED",
      result: { alreadySent: true },
    });
    expect(mailbox.sent).toHaveLength(1);
  });

  it("puts no token in what the approver reads", async () => {
    const { action } = await world();
    const described = action.describe(payload, action.targets(payload));
    const text = JSON.stringify(described);
    expect(text).not.toContain(FAKE_REFRESH_TOKEN);
    expect(text).not.toContain(FAKE_ACCESS_TOKEN);
    expect(described.preview).toContain(
      "To: Ada <ada@founder.example.invalid>",
    );
  });
});

describe("the email board", () => {
  it("hands the drafted payload to the run's own person only", async () => {
    const board = createEmailActionBoard();
    expect(
      board.prepareForApproval({
        runId: "run-1",
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        payload,
      }),
    ).toBe("PREPARED");
    const someoneElse = {
      ...actor,
      userId: "00000000-0000-4000-8000-0000000000b9",
    };
    const context = (who: ActorContext) =>
      ({ runId: "run-1", actor: who }) as unknown as Parameters<
        typeof board.proposer.propose
      >[0];
    expect(
      await board.proposer.propose(context(someoneElse as ActorContext)),
    ).toBeNull();
    board.prepareForApproval({
      runId: "run-1",
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      payload,
    });
    const proposal = await board.proposer.propose(context(actor));
    expect(proposal).toEqual({ actionType: EMAIL_SEND, payload });
    expect(EmailSendPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
