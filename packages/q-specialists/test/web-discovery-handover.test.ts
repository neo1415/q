import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnReading } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * URGENT regression, live 2026-11-06 on 3547127f2: discovery stopped
 * running. Run 01bef0a1 was read RESEARCH_REQUEST, DISCOVER_COMPANIES,
 * research EXPLICIT, without discoverWhom COMPANIES, so no web discovery
 * was handed over and the early web search answered with "broad lists".
 * Run f477cbe4 ("can you find more online? that maybe not exist in capital
 * Q yet", after a discovery list) was read PUBLIC_FACTS: the same.
 * The full answer path of the specialist seam, a scripted reading.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const CONVERSATION = randomUUID();

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function request(): QAnswerRequest {
  const runId = randomUUID();
  return {
    runId: runId as QAnswerRequest["runId"],
    tenantId: TENANT as QAnswerRequest["tenantId"],
    actorUserId: USER as QAnswerRequest["actorUserId"],
    actor,
    correlationId: "cor_test",
    capability: "ANSWER",
    subjects: [],
    retrieval: { kind: "NOT_CONFIGURED" },
    plan: PermittedContextPlanSchema.parse({
      contractVersion: 1,
      policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
      planId: randomUUID(),
      fingerprint: "0".repeat(64),
      runId,
      tenantId: TENANT,
      actor: { userId: USER, organisationId: actor.organisationId },
      purpose: { capability: "ANSWER", taskClass: "INVESTOR_QUESTION" },
      subjects: [],
      scopes: [],
      denied: [],
      maxSensitivity: "CONFIDENTIAL",
      allowedLayers: [],
      combinationConstraints: [],
      evaluatedAt: new Date().toISOString(),
      revalidateAfter: new Date(Date.now() + 60_000).toISOString(),
      revalidateOnResume: true,
    }),
  };
}

const EARLIER_LIST =
  "I searched the public web and found 2 companies.\n\n1. **Numida** · founded 2022 — Founders: Mina Shahid and Catherine Lahner. Fit: fintech. Source: [press.example](https://press.example/numida).\n2. **Owo Rails** — founders not named in the sources I read. Source: [weetracker.example](https://weetracker.example/a).";

function seam(said: string, reading: QTurnReading, earlierQ: string | null) {
  const at = (ms: number) => new Date(Date.now() - ms).toISOString();
  const message = (
    role: "USER" | "Q",
    content: string,
    ago: number,
  ): QConversationMessage => ({
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: at(ago),
  });
  const history = [
    ...(earlierQ === null
      ? []
      : [
          message("USER", "find me new companies online", 60_000),
          message("Q", earlierQ, 50_000),
        ]),
    message("USER", said, 0),
  ];
  const turns: QTurnReader = { read: () => Promise.resolve(reading) };
  const delegated: QAnswerRequest[] = [];
  const answer = createSpecialistQAnswer({
    specialist: {
      id: "company-intelligence",
      version: "v1",
      supports: () => false,
      investigate: () => Promise.reject(new Error("not used")),
    },
    delegate: {
      warm: () => undefined,
      answer: (req) => {
        delegated.push(req);
        return Promise.resolve({
          kind: "ANSWERED",
          messageId: "m",
          modelPolicyVersion: "none",
          promptBundleVersion: "b",
        });
      },
    },
    repositories: {
      messages: {
        listRecentForConversationOfRun: () => Promise.resolve(history),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) =>
          Promise.resolve({ ...input, id: randomUUID() }),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
  });
  return { answer, delegated };
}

const read = (
  kind: "RESEARCH_REQUEST" | "QUESTION_TO_Q",
  question: string,
  extra: Record<string, unknown> = {},
): QTurnReading =>
  ({
    kind,
    confidence: "HIGH",
    transcript: "CLEAR",
    question: {
      kind: question,
      text: "find me new companies online that i would be interested in",
      about: [],
      subject: null,
      count: null,
      discover: null,
    },
    aboutNamedOther: false,
    tool: null,
    ...extra,
  }) as never;

describe("web discovery is handed over whenever the reading asks for companies on the web", () => {
  it("run 01bef0a1: RESEARCH_REQUEST, DISCOVER_COMPANIES, no discoverWhom -> discovery", async () => {
    const s = seam(
      "find me new companies online that i would be interested in",
      read("RESEARCH_REQUEST", "DISCOVER_COMPANIES"),
      null,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeDefined();
  });

  it("a question that asks for the web for fit (FIT, asksForWeb) -> discovery with Capital Q's top 3", async () => {
    const s = seam(
      "find me new companies online that i would be interested in",
      read("QUESTION_TO_Q", "FIT", { asksForWeb: true }),
      null,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery?.alsoOnCapitalQ).toBe(true);
  });

  it("run f477cbe4: 'more online' read PUBLIC_FACTS after a discovery list -> discovery", async () => {
    const s = seam(
      "can you find more online? that maybe not exist in capital Q yet",
      read("RESEARCH_REQUEST", "PUBLIC_FACTS"),
      EARLIER_LIST,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeDefined();
  });

  it("a public-facts search with no discovery list is not a discovery", async () => {
    const s = seam(
      "what does the press say about Numida?",
      read("RESEARCH_REQUEST", "PUBLIC_FACTS"),
      null,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeUndefined();
  });

  it("investors asked for are never a company discovery", async () => {
    const s = seam(
      "find me investors online",
      read("RESEARCH_REQUEST", "DISCOVER_COMPANIES", {
        discoverWhom: "INVESTORS",
      }),
      EARLIER_LIST,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeUndefined();
  });

  // Batch 14 replay (run b19e26ed, savanna-seed on /discover): "find
  // paystack for me online now", after a discovery list, was read
  // RESEARCH_REQUEST, PUBLIC_FACTS, aboutNamedOther, research EXPLICIT --
  // and handed to discovery, which said the pages "didn't name specific
  // companies". One company named is that company, looked up on the web.
  const PAYSTACK = {
    aboutNamedOther: true,
    namedOther: { name: "Paystack", kind: "COMPANY" },
  };

  it("run b19e26ed: one named company asked for online, after a discovery list -> that company, not a discovery", async () => {
    const s = seam(
      "find paystack for me online now",
      read("RESEARCH_REQUEST", "PUBLIC_FACTS", PAYSTACK),
      EARLIER_LIST,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeUndefined();
    expect(s.delegated.at(-1)?.aboutNamedOther).toBe(true);
  });

  it("the same with the reading's discoverWhom COMPANIES -> still that company", async () => {
    const s = seam(
      "find paystack for me online now",
      read("RESEARCH_REQUEST", "PUBLIC_FACTS", {
        ...PAYSTACK,
        discoverWhom: "COMPANIES",
      }),
      null,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeUndefined();
  });

  it("companies LIKE a named one are still a discovery", async () => {
    const s = seam(
      "find me companies like paystack online",
      read("RESEARCH_REQUEST", "DISCOVER_COMPANIES", {
        ...PAYSTACK,
        discoverWhom: "COMPANIES",
      }),
      null,
    );
    await s.answer.answer(request());
    expect(s.delegated.at(-1)?.webDiscovery).toBeDefined();
  });
});
