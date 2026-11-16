import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type {
  QPageMovePort,
  QTurnReader,
  QTurnSkimmer,
} from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer, type QRunRouting } from "../src/answer.js";

/**
 * Replay of scenarios D-E (live 2026-11-16 on bab915357, defect 7, runs
 * 585e27d3, d58a4564, 7cef5d87): every investor question about a company's
 * own figures, diligence or documents was read with research EXPLICIT and
 * ran `public_web.search` with the whole question as its query. Their own
 * records answer those; the web is asked only when the person's words ask
 * about the public world. Through the answer entry q-api composes; fakes
 * only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const CONVERSATION = randomUUID();

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

/** An investor whose own mandate is in the plan (the old word lane's condition). */
function investorRequest(): QAnswerRequest {
  const runId = randomUUID();
  const subject = {
    kind: "INVESTOR_ORGANISATION" as const,
    investorOrganisationId: ORG,
  };
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
      subjects: [subject],
      scopes: [
        {
          kind: "INVESTOR_MANDATE",
          subject,
          contextLabel: "investor_private",
          sensitivity: "CONFIDENTIAL",
          layer: "STRUCTURED_STATE",
          factCategories: ["INVESTOR_THESIS"],
          projection: "FULL",
          rights: {
            canUseForReasoning: true,
            canDiscloseExistence: true,
            canQuote: true,
            canProvideLink: false,
          },
          filter: { tenantId: TENANT, investorOrganisationId: ORG },
          isEvidence: true,
        },
      ],
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

function message(
  role: "USER" | "Q",
  content: string,
  blocks?: QConversationMessage["blocks"],
): QConversationMessage {
  return {
    id: randomUUID() as QConversationMessage["id"],
    tenantId: TENANT as QConversationMessage["tenantId"],
    conversationId: CONVERSATION as QConversationMessage["conversationId"],
    runId: randomUUID() as QConversationMessage["runId"],
    role,
    content,
    contentType: "TEXT",
    createdAt: new Date().toISOString(),
    ...(blocks === undefined ? {} : { blocks }),
  };
}

function seam(
  said: string,
  reading: Record<string, unknown>,
  earlier: readonly QConversationMessage[],
  skimmed: Record<string, unknown> | null = null,
  pageMoves?: QPageMovePort,
) {
  let reads = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
      return Promise.resolve(reading as never);
    },
  };
  const turnSkim: QTurnSkimmer = {
    skim: () => Promise.resolve(skimmed as never),
  };
  const delegated: QAnswerRequest[] = [];
  const routings: QRunRouting[] = [];
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
        listRecentForConversationOfRun: () =>
          Promise.resolve([...earlier, message("USER", said)]),
        mark: () => Promise.resolve(),
        insert: (_tx: unknown, input: Omit<QConversationMessage, "id">) =>
          Promise.resolve({
            ...input,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
          }),
      },
      runs: { allocateEventSequence: () => Promise.resolve(1) },
      runEvents: { append: () => Promise.resolve({}) },
    } as unknown as QRuntimeRepositories,
    sql: {} as never,
    transactions: { run: (work) => work({} as never) },
    turns,
    turnSkim,
    ...(pageMoves === undefined ? {} : { pageMoves }),
    recordRouting: ({ routing }) => {
      routings.push(routing);
      return Promise.resolve();
    },
  });
  return { answer, delegated, routings, reads: () => reads };
}

/** The live reading: about Halyard, their own records, research EXPLICIT. */
const halyardReading = (text: string, questionKind = "THEIR_OWN_RECORDS") => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: questionKind, text },
  aboutNamedOther: true,
  namedOther: { kind: "COMPANY", name: "Halyard Security" },
  asksForWeb: false,
});

describe("an investor's own-records question keeps off the public web (defect 7)", () => {
  it.each([
    // The live asks (D1, D2, D4).
    "How much cash does Halyard Security actually have in the bank right now?",
    "Halyard has just answered the bank statement request. Does the bank balance agree with their management accounts?",
    "What closing balance does Halyard Security's latest bank statement show?",
    // Unseen paraphrases.
    "Has Halyard Security sent the cap table we asked for in diligence?",
    "What's Halyard Security's burn according to the documents they shared?",
  ])("%s", async (said) => {
    const s = seam(said, halyardReading(said), [message("Q", "Welcome back.")]);
    await s.answer.answer(investorRequest());
    expect((await s.delegated[0]?.research)?.mode).toBe("NEVER");
    expect(s.routings[0]).toMatchObject({
      research: "NEVER",
      researchGuard: "OWN_RECORDS",
    });
  });

  it("a figures question about a named company is held too, whatever the question kind", async () => {
    const said =
      "What runway does Halyard Security have on their October accounts?";
    const s = seam(said, halyardReading(said, "ADVICE"), []);
    await s.answer.answer(investorRequest());
    expect(s.routings[0]?.researchGuard).toBe("OWN_RECORDS");
  });

  it("their words asking about the public world keep the reading's research", async () => {
    const said =
      "Is there any news coverage of Halyard Security's bank balance or funding?";
    const s = seam(said, halyardReading(said), []);
    await s.answer.answer(investorRequest());
    expect(s.routings[0]?.researchGuard).toBeNull();
    expect((await s.delegated[0]?.research)?.mode).not.toBe("NEVER");
  });
});
