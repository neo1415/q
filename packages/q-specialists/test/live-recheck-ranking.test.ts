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

import { createSpecialistQAnswer, type QRunRouting } from "../src/answer.js";

/**
 * Live re-check of production 651a3bd50 (15 Nov 2026,
 * docs/ai-handoff/audits/2026-11-15-q-voice-audit/live-recheck-651a3bd50.md),
 * replayed through the answer entry q-api composes. Fakes only.
 *
 * T1: a new conversation's first ranking turn ("Of my best-fitting
 * companies, which ones actually bring in revenue?") was answered by the
 * FIT_BY_CODE word lane before the turn reader ran, so the revenue
 * condition was never read, and the run kept no routing.
 * T8: "What's the biggest gap we have right now, and which investor should
 * I approach first?" opened with "By the first one I mean Zino Aviation…":
 * "first" was read as a place in Q's list from the word alone.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const CONVERSATION = randomUUID();
const MEDTRAIL = "3ab2cc02-160f-4812-a6b1-000000000001";
const MIZAN = "3ab2cc02-160f-4812-a6b1-000000000002";
const ZINO = "5ab2cc02-160f-4812-a6b1-000000000001";
const BAOBAB = "5ab2cc02-160f-4812-a6b1-000000000002";

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

function cardsMessage(
  content: string,
  title: string,
  cards: readonly {
    readonly name: string;
    readonly subject: Record<string, string>;
  }[],
): QConversationMessage {
  return message("Q", content, [
    {
      kind: "ANSWER_CARDS",
      title,
      shape: "RANKED",
      cards: cards.map((card, at) => ({
        key: `c${String(at)}`,
        name: card.name,
        line: null,
        hue: 0,
        fit: { score: 9.2, measured: 9, of: 9 },
        reasons: [],
        measures: [],
        subject: card.subject,
      })),
      followUps: [],
    } as never,
  ]);
}

function seam(
  said: string,
  reading: Record<string, unknown>,
  earlier: readonly QConversationMessage[],
  skimmed: Record<string, unknown> | null = null,
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
    recordRouting: ({ routing }) => {
      routings.push(routing);
      return Promise.resolve();
    },
  });
  return { answer, delegated, routings, reads: () => reads };
}

const revenueReading = (text: string) => ({
  kind: "QUESTION_TO_Q",
  confidence: "HIGH",
  transcript: "CLEAR",
  question: {
    kind: "FIT",
    text,
    count: null,
    listConditions: {
      relationship: null,
      revenue: "HAS_REVENUE",
      sector: null,
      stage: null,
      geography: null,
      order: "BEST_FIRST",
    },
  },
});

describe("live re-check T1: no ranking is answered before the reader's conditions are known", () => {
  const said =
    "Of my best-fitting companies, which ones actually bring in revenue?";

  it("the word-shaped fit ranking waits for the reading, and its condition reaches the answer", async () => {
    const s = seam(said, revenueReading(said), []);
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(1);
    expect(s.delegated).toHaveLength(1);
    expect(s.delegated[0]?.questionKind).toBe("FIT");
    expect(s.delegated[0]?.listConditions?.revenue).toBe("HAS_REVENUE");
  });

  it("a quick first read of FIT does not answer it either", async () => {
    const s = seam(said, revenueReading(said), [], {
      kind: "FIT",
      confidence: "HIGH",
      count: null,
      onWeb: false,
    });
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(1);
    expect(s.delegated[0]?.listConditions?.revenue).toBe("HAS_REVENUE");
  });

  it("the run keeps its routing, with the execution class", async () => {
    const s = seam(said, revenueReading(said), []);
    await s.answer.answer(investorRequest());
    expect(s.routings).toHaveLength(1);
    expect(s.routings[0]).toMatchObject({
      kind: "QUESTION_TO_Q",
      question: "FIT",
      lane: "READER",
      executionClass: "STRUCTURED_QUERY",
    });
  });

  it("a run answered by a code lane before any reading keeps its routing too", async () => {
    const s = seam("thanks Q", revenueReading("thanks Q"), []);
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(0);
    expect(s.routings).toHaveLength(1);
    expect(s.routings[0]).toMatchObject({
      kind: "CODE_LANE",
      executionClass: null,
    });
  });
});

describe("live re-check T8: a place in Q's list only when the reading marks one", () => {
  const investors = cardsMessage(
    "Talk to Zino Aviation and Baobab Ridge Capital first.",
    "Investors to talk to first",
    [
      {
        name: "Zino Aviation",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: ZINO,
        },
      },
      {
        name: "Baobab Ridge Capital (fictional)",
        subject: {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: BAOBAB,
        },
      },
    ],
  );

  it("'who should I approach first' is not 'the first one' of the shown list", async () => {
    const said =
      "What's the biggest gap we have right now, and which investor should I approach first?";
    const s = seam(
      said,
      {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        question: { kind: "ADVICE", text: said },
        parts: [
          { text: "the biggest gap", kind: "ANALYSIS" },
          { text: "which investor first", kind: "ANALYSIS" },
        ],
      },
      [message("USER", "Which investors fit us?"), investors],
    );
    await s.answer.answer(investorRequest());
    expect(s.reads()).toBe(1);
    expect(s.delegated[0]?.referenceLead).toBeUndefined();
    expect(s.delegated[0]?.references ?? "").not.toContain("Zino");
  });

  it("'Why the first one?' with the reading's own pointer keeps the place, and names the company for the follow-up", async () => {
    const companies = cardsMessage(
      "Ranked by fit with your mandate: MedTrail at 9.2 and Mizan at 9.2.",
      "Fit against your mandate",
      [
        { name: "MedTrail", subject: { kind: "COMPANY", companyId: MEDTRAIL } },
        { name: "Mizan", subject: { kind: "COMPANY", companyId: MIZAN } },
      ],
    );
    const s = seam(
      "Why the first one?",
      {
        kind: "QUESTION_TO_Q",
        confidence: "HIGH",
        transcript: "CLEAR",
        answerKind: "FOLLOW_UP",
        question: null,
        reference: {
          open: null,
          name: "MedTrail",
          shown: 1,
          retryLast: false,
          sameFor: null,
        },
      },
      [message("USER", "Which companies fit my mandate best?"), companies],
    );
    await s.answer.answer(investorRequest());
    expect(s.delegated[0]?.referenceLead?.name).toBe("MedTrail");
    expect(s.delegated[0]?.followUpCompanyId).toBe(MEDTRAIL);
  });
});
