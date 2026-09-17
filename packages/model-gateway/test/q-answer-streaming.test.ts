import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import type { PermittedContextPlan } from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { createModelGatewayQAnswer } from "../src/q/index.js";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import { testCatalog } from "./fixtures.js";

/**
 * The answer, reaching a person as it is written.
 *
 * What is asserted here is not that something arrives early — it is WHAT
 * arrives. A fragment a person receives has to be the answer rather than
 * the object around it, whole rather than half a sentence, and already
 * through the guards, because on a voice call it is about to be said out
 * loud and nothing said can be unsaid.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const RUN = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "55555555-5555-4555-8555-555555555555";

function plan(): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "66666666-6666-4666-8666-666666666666",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "GENERAL_QUESTION" },
    subjects: [],
    scopes: [],
    denied: [],
    maxSensitivity: "PUBLIC",
    allowedLayers: ["GENERAL_MODEL"],
    combinationConstraints: [],
    evaluatedAt: "2026-09-16T10:00:00.000Z",
    revalidateAfter: "2026-09-16T10:05:00.000Z",
    revalidateOnResume: true,
  } as unknown as PermittedContextPlan;
}

function build(
  answer: string,
  extras: Record<string, unknown> = {},
  capture: { content?: string; noted?: unknown[] } = {},
) {
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: "Tell me about Paystack.",
      contentType: "TEXT",
      createdAt: "2026-09-16T10:00:00.000Z",
    } as unknown as QConversationMessage,
  ];
  const stored: { id?: string } = {};
  const published: { messageId: string; text: string }[] = [];

  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [
      {
        kind: "JSON",
        value: {
          answer,
          responseShape: "CONCISE",
          insufficientEvidence: false,
          recommendation: null,
          ...extras,
        },
      },
    ],
  });
  const gateway = createModelGateway({
    catalog: createStaticModelCatalog(testCatalog()),
    registry: createModelProviderRegistry([alpha]),
    usage: createInMemoryModelUsageRepository(),
    sleep: () => Promise.resolve(),
    random: () => 0.5,
  });

  const repositories = {
    messages: {
      listRecentForConversationOfRun: () => Promise.resolve([...messages]),
      listForRun: () => Promise.resolve([...messages]),
      insert: (
        _tx: unknown,
        input: { id?: string | undefined; content: string },
      ) => {
        if (input.id !== undefined) {
          stored.id = input.id;
        }
        capture.content = input.content;
        const message = {
          ...messages[0],
          id: input.id ?? randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage;
        return Promise.resolve(message);
      },
      findById: () => Promise.resolve(null),
    },
    runs: { allocateEventSequence: () => Promise.resolve(2) },
    runEvents: { append: () => Promise.resolve({}) },
  } as unknown as QRuntimeRepositories;

  const seam = createModelGatewayQAnswer({
    gateway,
    repositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    deltas: {
      publish: (delta) => {
        published.push({ messageId: delta.messageId, text: delta.text });
      },
      subscribe: () => () => undefined,
      subscriberCount: () => 1,
    },
    profileUpdates: {
      note: (entry) => {
        capture.noted = [...(capture.noted ?? []), entry];
      },
    },
  });

  const request: QAnswerRequest = {
    runId: RUN as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId: ORG }],
    plan: plan(),
  } as unknown as QAnswerRequest;

  return { seam, request, published, stored };
}

describe("an answer that arrives as it is written", () => {
  it("sends whole sentences, in order, and nothing of the object around them", async () => {
    const answer =
      "Paystack is a Nigerian payments company. Stripe acquired it in 2020. It serves about 60,000 merchants.";
    const { seam, request, published } = build(answer);
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");

    expect(published.map((d) => d.text.trim())).toEqual([
      "Paystack is a Nigerian payments company.",
      "Stripe acquired it in 2020.",
    ]);
    // Nothing that belongs to the JSON document ever leaves.
    const everything = published.map((d) => d.text).join("");
    for (const shard of ['{"', "answer", "responseShape", "CONCISE", "}"]) {
      expect(everything, shard).not.toContain(shard);
    }
  });

  it("leaves the last sentence to the completed message, which is the durable form", async () => {
    // The final fragment is the one thing that cannot be known to be
    // whole while text is still arriving, so it is never guessed at.
    const { seam, request, published } = build("One. Two. Three.");
    await seam.answer(request);
    expect(published.map((d) => d.text.trim())).toEqual(["One.", "Two."]);
  });

  it("names the message before its text exists, so the pieces and the whole are one thing", async () => {
    const { seam, request, published, stored } = build("First. Second. Done.");
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    if (outcome.kind !== "ANSWERED") return;
    expect(stored.id).toBe(outcome.messageId);
    for (const delta of published) {
      expect(delta.messageId).toBe(outcome.messageId);
    }
  });

  it("keeps an answer that was heard when the object around it is refused", async () => {
    // Live: the answer was read out sentence by sentence, then the final
    // object failed its schema on a field the person never sees, and Q
    // said it had hit a snag and to ask again. An answer that has been
    // delivered is not a failure: the text stands, and is persisted as the
    // message the stream converges on.
    const stored: { content?: string } = {};
    const { seam, request, published } = build(
      "Paystack is a Nigerian payments company. Stripe acquired it in 2020. It serves many merchants.",
      // Refused by the schema (strict): a field the task does not define.
      { somethingTheSchemaRefuses: true },
      stored,
    );
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(published.length).toBeGreaterThan(0);
    // The whole answer, last sentence included, because the reader saw
    // the answer close before the object was refused.
    expect(stored.content).toBe(
      "Paystack is a Nigerian payments company. Stripe acquired it in 2020. It serves many merchants.",
    );
  });

  it("hands a requested profile change to the proposer only when the person actually said it", async () => {
    // The person's message in this harness is "Tell me about Paystack.";
    // a reading whose quote is not in it is dropped, one that is goes on.
    const capture: { content?: string; noted?: unknown[] } = {};
    const { seam, request } = build(
      "Done.",
      {
        profileUpdates: [
          { field: "websiteUrl", value: "https://x.com", quote: "invented" },
          {
            field: "shortDescription",
            value: "Payments",
            quote: "tell me about paystack",
          },
          // No value and no word about clearing: a question, never a change.
          {
            field: "canonicalName",
            value: null,
            quote: "tell me about paystack",
          },
        ],
      },
      capture,
    );
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(capture.noted).toEqual([
      {
        runId: RUN,
        tenantId: TENANT,
        companyId: ORG,
        updates: [
          {
            field: "shortDescription",
            value: "Payments",
            quote: "tell me about paystack",
          },
        ],
      },
    ]);
    expect(capture.content).toContain("prepared that change to your profile");
  });

  it("puts a sentence through the guards before anybody hears it", async () => {
    // An opening that only promises to act, and an invented ranking claim
    // Capital Q has no basis for. Both are removed from a finished answer;
    // both have to be removed from a spoken one too, because a sentence
    // already said cannot be taken back.
    const { seam, request, published } = build(
      "Let me check that. Paystack processes payments across Africa. They are a top-decile performer in their peer group. Stripe acquired them in 2020.",
    );
    await seam.answer(request);
    const spoken = published.map((d) => d.text).join(" ");
    expect(spoken).toContain("Paystack processes payments across Africa.");
    expect(spoken).not.toMatch(/let me check/i);
    expect(spoken).not.toMatch(/top-decile/i);
  });
});
