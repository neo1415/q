import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { PermittedContextPlan } from "@capital-q/contracts";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import {
  createFakeModelProvider,
  createInMemoryModelUsageRepository,
  createModelGateway,
  createModelProviderRegistry,
  createStaticModelCatalog,
} from "../src/index.js";
import { acceptStructuredOutput } from "../src/policy/structured.js";
import {
  createModelGatewayQAnswer,
  UNPREPARED_CHANGE_LINE,
} from "../src/q/index.js";
import { testCatalog } from "./fixtures.js";

/**
 * Q never says a change was noted, made or on its way unless Capital Q
 * holds one (CQ-QX-007 A5).
 *
 * Live: "also our site moved to kivu-freight.africa, update it please".
 * The analyst read the change, but one of its statements carried a
 * malformed knowledge key; the whole reading was refused, the change was
 * never proposed, and the prose that went out said the change was "noted
 * for the company profile update".
 */

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const COMPANY = "77777777-7777-4777-8777-777777777777";
const RUN = "44444444-4444-4444-8444-444444444444";
const CONVERSATION = "55555555-5555-4555-8555-555555555555";

const SAID = "also our site moved to kivu-freight.africa, update it please";
const CLAIM =
  "The website change to kivu-freight.africa is noted for the company profile update.";

function plan(): PermittedContextPlan {
  return {
    contractVersion: 1,
    policyVersion: "context-firewall-v2",
    planId: "66666666-6666-4666-8666-666666666666",
    fingerprint: "a".repeat(64),
    runId: RUN,
    tenantId: TENANT,
    actor: { userId: USER, organisationId: ORG },
    purpose: { capability: "ANSWER", taskClass: "OWN_COMPANY_QUESTION" },
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
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

function build(object: Record<string, unknown>) {
  const capture: { content?: string; noted: unknown[] } = { noted: [] };
  const messages: QConversationMessage[] = [
    {
      id: randomUUID(),
      tenantId: TENANT,
      conversationId: CONVERSATION,
      runId: RUN,
      role: "USER",
      content: SAID,
      contentType: "TEXT",
      createdAt: "2026-09-16T10:00:00.000Z",
    } as unknown as QConversationMessage,
  ];
  const alpha = createFakeModelProvider({
    code: "alpha",
    script: [{ kind: "JSON", value: object }],
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
      insert: (_tx: unknown, input: { content: string }) => {
        capture.content = input.content;
        return Promise.resolve({
          ...messages[0],
          id: randomUUID(),
          role: "Q",
          content: input.content,
        } as QConversationMessage);
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
      publish: () => undefined,
      subscribe: () => () => undefined,
      subscriberCount: () => 1,
    },
    profileUpdates: {
      note: (entry) => {
        capture.noted.push(entry);
      },
    },
  });
  const request = {
    runId: RUN,
    tenantId: TENANT,
    actorUserId: USER,
    actor: ActorContextSchema.parse({
      userId: USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    }),
    correlationId: `cor_${RUN}`,
    capability: "ANSWER",
    subjects: [{ kind: "COMPANY", companyId: COMPANY }],
    plan: plan(),
  } as unknown as QAnswerRequest;
  return { seam, request, capture };
}

const WEBSITE_CHANGE = {
  field: "websiteUrl",
  value: "https://kivu-freight.africa",
  quote: "our site moved to kivu-freight.africa",
};

describe("A5: a malformed statement no longer throws away the change beside it", () => {
  it("proposes the website change and makes no claim of its own about it", async () => {
    const { seam, request, capture } = build({
      answer: `${CLAIM} Anything else you'd like to update?`,
      responseShape: "CONCISE",
      insufficientEvidence: false,
      recommendation: null,
      // What luna wrote: a knowledge key outside the recordable pattern.
      userStatements: [
        {
          quote: "our site moved to kivu-freight.africa",
          statement: "The company website moved to kivu-freight.africa.",
          knowledgeKey: "Company Website URL",
          validFrom: null,
        },
      ],
      profileUpdates: [WEBSITE_CHANGE],
      // The model did not mark its own sentence as talk about acting.
      actionTalk: [],
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    // The change reached the proposer, which is what makes a proposal —
    // and an Approve button — exist.
    expect(capture.noted).toEqual([
      {
        runId: RUN,
        tenantId: TENANT,
        companyId: COMPANY,
        updates: [WEBSITE_CHANGE],
      },
    ]);
    // Q's own sentence about the change is gone; Capital Q says what
    // became of it from the proposal.
    expect(capture.content).not.toContain("noted");
    expect(capture.content).not.toContain("kivu-freight.africa");
    expect(capture.content).toContain("Anything else you'd like to update?");
  });

  it("removes the sentences the model itself marked as talk about acting", async () => {
    const { seam, request, capture } = build({
      answer:
        "I have prepared the update for your approval. Your deck still lists the old address.",
      responseShape: "CONCISE",
      insufficientEvidence: false,
      recommendation: null,
      profileUpdates: [WEBSITE_CHANGE],
      actionTalk: ["I have prepared the update for your approval."],
    });
    await seam.answer(request);
    expect(capture.content).toBe("Your deck still lists the old address.");
    expect(capture.noted).toHaveLength(1);
  });

  it("says plainly that nothing changed when the whole reading is refused", async () => {
    const { seam, request, capture } = build({
      answer: CLAIM,
      // Outside the closed vocabulary: the object itself is refused.
      responseShape: "VERBOSE",
      insufficientEvidence: false,
      recommendation: null,
      profileUpdates: [WEBSITE_CHANGE],
      actionTalk: [CLAIM],
    });
    const outcome = await seam.answer(request);
    expect(outcome.kind).toBe("ANSWERED");
    expect(capture.noted).toEqual([]);
    expect(capture.content).not.toContain("noted");
    expect(capture.content).toContain(UNPREPARED_CHANGE_LINE);
  });
});

describe("structured acceptance: one refused list element, not the whole object", () => {
  const Schema = z
    .object({
      answer: z.string().min(1),
      statements: z
        .array(z.object({ key: z.string().regex(/^[a-z.]+$/) }).strict())
        .default([]),
      updates: z.array(z.object({ field: z.string() }).strict()).default([]),
    })
    .strict();
  const text = JSON.stringify({
    answer: "ok",
    statements: [{ key: "Bad Key" }, { key: "company.website" }],
    updates: [{ field: "websiteUrl" }],
  });

  it("refuses the object by default, exactly as before", () => {
    const refused = acceptStructuredOutput(text, Schema);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusals).toEqual(["statements.0.key:invalid_format"]);
    }
  });

  it("drops only the refused element when asked, and says which", () => {
    const kept = acceptStructuredOutput(text, Schema, {
      invalidListItems: "DROP",
    });
    expect(kept).toEqual({
      ok: true,
      value: {
        answer: "ok",
        statements: [{ key: "company.website" }],
        updates: [{ field: "websiteUrl" }],
      },
      dropped: ["statements.0.key:invalid_format"],
    });
  });

  it("never drops a field that is not a list element", () => {
    const outside = acceptStructuredOutput(
      JSON.stringify({ answer: "", statements: [], updates: [] }),
      Schema,
      { invalidListItems: "DROP" },
    );
    expect(outside.ok).toBe(false);
  });
});
