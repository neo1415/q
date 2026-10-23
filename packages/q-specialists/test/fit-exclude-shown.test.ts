import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
} from "@capital-q/contracts";
import type { QTurnReader, QTurnSkimmer } from "@capital-q/model-gateway/q";
import type {
  QAnswerRequest,
  QConversationMessage,
  QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { ActorContextSchema } from "@capital-q/security";

import { createSpecialistQAnswer } from "../src/answer.js";

/**
 * Production 2026-10-17, conversation 4f07dae7: after the top three, "give
 * me three new companies that fit my mandate" returned two of them again.
 * The reader's FIT question carries `excludeShown` (TURN_READER v56), and
 * the answer path hands it to the computed fit. Fakes only.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const CONVERSATION = randomUUID();
const SHOWN = [
  "3ab2cc02-160f-4812-a6b1-000000000001",
  "3ab2cc02-160f-4812-a6b1-000000000002",
  "3ab2cc02-160f-4812-a6b1-000000000003",
];

const actor = ActorContextSchema.parse({
  userId: USER,
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

/** An investor whose own mandate is in the plan (the instant fit lane's condition). */
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

/** Q's earlier answer: the top three as company cards. */
const TOP_THREE = message("Q", "Your top three.", [
  {
    kind: "ANSWER_CARDS",
    title: "Fit against your mandate",
    shape: "RANKED",
    cards: ["Ledgerfold", "Basketari", "Brancheon Works"].map((name, i) => ({
      name,
      summary: `${name} summary.`,
      reasons: [],
      fit: null,
      subject: { kind: "COMPANY", companyId: SHOWN[i] },
    })),
    followUps: [],
  } as never,
]);

function seam(
  said: string,
  reading: Record<string, unknown>,
  earlier: readonly QConversationMessage[],
) {
  let reads = 0;
  const turns: QTurnReader = {
    read: () => {
      reads += 1;
      return Promise.resolve(reading as never);
    },
  };
  const turnSkim: QTurnSkimmer = { skim: () => Promise.resolve(null) };
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
        listRecentForConversationOfRun: () =>
          Promise.resolve([...earlier, message("USER", said)]),
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
    turnSkim,
  });
  return { answer, delegated, reads: () => reads };
}

const fitReading = (text: string, extra: Record<string, unknown>) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: { kind: "FIT", text, count: 3, ...extra },
});

describe("v56 excludeShown on the answer path", () => {
  it("hands the reader's excludeShown to the computed fit, under the same plan", async () => {
    const said = "give me three new companies that fit my mandate";
    const s = seam(said, fitReading(said, { excludeShown: true }), [TOP_THREE]);
    const req = investorRequest();
    await s.answer.answer(req);
    expect(s.reads()).toBe(1);
    const delegated = s.delegated[0];
    expect(delegated?.questionKind).toBe("FIT");
    expect(delegated?.fitQuestion).toEqual({
      text: said,
      count: 3,
      previous: false,
      excludeShown: true,
      mandateRelevant: false,
    });
    // Nothing about authorization changes: the same plan and actor.
    expect(delegated?.plan).toBe(req.plan);
    expect(delegated?.actor).toBe(req.actor);
  });

  it("a reading without the field is not an exclusion", async () => {
    const said = "which companies fit my mandate?";
    const s = seam(said, fitReading(said, {}), [TOP_THREE]);
    await s.answer.answer(investorRequest());
    expect(s.delegated[0]?.fitQuestion?.excludeShown).toBe(false);
  });

  it("after company cards were shown, a fit ranking waits for the reading instead of the code lane", async () => {
    const said = "Show my top 3 companies against my mandate";
    const s = seam(said, fitReading(said, { excludeShown: true }), [TOP_THREE]);
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(1);
    expect(s.delegated[0]?.fitQuestion?.excludeShown).toBe(true);
  });

  it("with nothing shown yet, the code lane still answers without a reading", async () => {
    const said = "Show my top 3 companies against my mandate";
    const s = seam(said, fitReading(said, {}), []);
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(0);
    expect(s.delegated[0]?.fitQuestion).toEqual({
      text: said,
      count: null,
      previous: false,
    });
  });
});
