import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import {
  answerKnowledgeKey,
  createInvestorAnswerRecorder,
  type KnowledgeWriteCommand,
} from "../src/index.js";

/**
 * A founder's answer to an investor's question (2026-10-08) is evidence
 * (a USER_STATEMENT source pointing at the question, an item with their
 * words) and a USER_CLAIM candidate through the gate. Never verified.
 */

const actor = {
  userId: "00000000-0000-4000-8000-00000000a0a1",
} as unknown as ActorContext;

describe("investor answer recorder", () => {
  it("records the founder's words as their claim, with the question as provenance", async () => {
    const sources: string[] = [];
    const submitted: KnowledgeWriteCommand[] = [];
    const recorder = createInvestorAnswerRecorder({
      evidence: {
        registerStatementSource: (_a, input) => {
          sources.push(input.externalReference);
          return Promise.resolve({
            id: "00000000-0000-4000-8000-00000000a0b1",
          });
        },
        createStatementItem: (_a, input) => {
          expect(input.summary).toBe("131 paid in September.");
          return Promise.resolve({
            id: "00000000-0000-4000-8000-00000000a0c1",
          });
        },
      },
      gate: {
        submit: (command) => {
          submitted.push(command);
          return Promise.resolve({
            outcome: "PERSISTED",
            objectId: "00000000-0000-4000-8000-00000000a0d1",
          } as never);
        },
      },
      clock: () => new Date("2026-10-08T09:00:00.000Z"),
    });
    const out = await recorder.record({
      actor,
      companyId: "00000000-0000-4000-8000-00000000a0e1",
      questionId: "00000000-0000-4000-8000-00000000a0f1",
      about: "Paying customers",
      answer: "  131 paid in September.  ",
      correlationId: "cor_x",
    });
    expect(sources).toEqual([
      "diligence-question:00000000-0000-4000-8000-00000000a0f1",
    ]);
    expect(submitted[0]?.candidate).toMatchObject({
      truthClassProposal: "USER_CLAIM",
      knowledgeKey: "diligence.answer.paying_customers",
      supportingEvidenceItemIds: ["00000000-0000-4000-8000-00000000a0c1"],
      reason: "USER_ANSWERED_INVESTOR_QUESTION",
    });
    expect(out).toEqual({
      evidenceItemId: "00000000-0000-4000-8000-00000000a0c1",
      knowledgeObjectId: "00000000-0000-4000-8000-00000000a0d1",
    });
  });

  it("keys a question with no subject as general", () => {
    expect(answerKnowledgeKey(null)).toBe("diligence.answer.general");
    expect(answerKnowledgeKey("12-month runway (est.)")).toBe(
      "diligence.answer.n12_month_runway_est",
    );
  });
});
