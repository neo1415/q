import { randomUUID } from "node:crypto";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  QConversationIdSchema,
  PermittedContextPlanSchema,
  Q_CONTEXT_FIREWALL_POLICY_VERSION,
  QRunIdSchema,
} from "@capital-q/contracts";
import { ActorContextSchema } from "@capital-q/security";
import type { ArtifactPreparation } from "@capital-q/q-specialists";

import { createWorkforceDiligence } from "../src/composition/workforce/diligence.js";
import type { WorkforceModels } from "../src/composition/workforce/models.js";

/**
 * DILIGENCE (2026-10-12): founder questions drawn from the memo's gaps and
 * its critique are filed as the investor's approval card for the existing
 * send action -- never sent by Q -- and kept with the job when there is no
 * connection to send them through.
 */

const actor = ActorContextSchema.parse({
  tenantId: randomUUID(),
  userId: randomUUID(),
  organisationId: randomUUID(),
  membershipId: randomUUID(),
  actorType: "HUMAN",
});
const companyId = randomUUID();
const qRunId = QRunIdSchema.parse(randomUUID());
const relationshipId = randomUUID();

function world(
  options: {
    readonly state?: string | null;
    readonly drafted?: boolean;
    readonly authorised?: boolean;
  } = {},
) {
  const plan = PermittedContextPlanSchema.parse({
    contractVersion: 1,
    policyVersion: Q_CONTEXT_FIREWALL_POLICY_VERSION,
    planId: randomUUID(),
    fingerprint: "0".repeat(64),
    runId: qRunId,
    tenantId: actor.tenantId,
    actor: { userId: actor.userId, organisationId: actor.organisationId },
    purpose: {
      capability: "ANSWER",
      taskClass: "COUNTERPARTY_COMPANY_QUESTION",
    },
    subjects: [{ kind: "COMPANY", companyId }],
    scopes: [],
    denied: [],
    maxSensitivity: "CONFIDENTIAL",
    allowedLayers: [],
    combinationConstraints: [],
    evaluatedAt: new Date().toISOString(),
    revalidateAfter: new Date(Date.now() + 60000).toISOString(),
    revalidateOnResume: true,
  });
  const currentVersion = vi.fn<ArtifactPreparation["port"]["currentVersion"]>(
    () =>
      Promise.resolve({
        artifactId: randomUUID(),
        version: 2,
        title: "Ledgerfold — investment memo",
        summary: "A memo.",
        content: {
          sections: [
            {
              heading: "Traction",
              body: "Founder reports 400 customers.",
              findings: [],
            },
          ],
          gaps: ["Monthly burn", "Default rate on loans"],
        },
      } as never),
  );
  const questions = vi.fn<WorkforceModels["diligenceQuestions"]>(() =>
    Promise.resolve(
      options.drafted === false
        ? null
        : {
            questions: [
              {
                question: "What was monthly burn over the last three months?",
                about: "Monthly burn",
              },
              {
                question:
                  "What share of loans defaulted in the last two quarters?",
                about: "Default rate",
              },
            ],
          },
    ),
  );
  const propose = vi.fn((_input: unknown) =>
    Promise.resolve({ action: { id: "action-1" } } as never),
  );
  const createRun = vi.fn((_input: unknown) =>
    Promise.resolve({
      created: true,
      run: {
        id: randomUUID(),
        tenantId: actor.tenantId,
        conversationId: randomUUID(),
      },
      conversation: { id: randomUUID() },
    } as never),
  );
  const ok = () => Promise.resolve();
  const conversationId = QConversationIdSchema.parse(randomUUID());
  const conversationForRun = vi.fn(() => Promise.resolve(conversationId));
  const diligence = createWorkforceDiligence({
    freshActor: () => Promise.resolve(actor),
    firewall: {
      plan: vi.fn(() =>
        Promise.resolve(
          options.authorised === false
            ? ({ outcome: "DENIED" } as never)
            : { outcome: "AUTHORISED" as const, plan },
        ),
      ),
    },
    currentVersion,
    questions,
    relationshipWith: () =>
      Promise.resolve(
        options.state === null
          ? null
          : { relationshipId, state: options.state ?? "CONNECTED" },
      ),
    runtime: { createRun },
    conversationForRun,
    orchestration: {
      begin: ok,
      advanceThrough: ok,
      fail: ok,
      complete: ok,
    } as never,
    actions: { propose },
  });
  const input = {
    actor,
    canContinue: () => Promise.resolve(true),
    goal: "Prepare founder diligence questions",
    qRunId,
    jobId: randomUUID(),
    stepKey: "questions",
    runId: randomUUID(),
    organisationId: actor.organisationId ?? "",
    source: { artifactId: randomUUID(), companyId },
    critique: ["Risks: default rate is not addressed."],
  };
  return {
    diligence,
    input,
    propose,
    questions,
    createRun,
    conversationId,
    conversationForRun,
  };
}

describe("the diligence specialist", () => {
  it("files the questions as the investor's own approval card, never a send", async () => {
    const w = world();
    const result = await w.diligence(w.input);
    expect(result).toMatchObject({ status: "CARDED", qActionId: "action-1" });
    expect(w.conversationForRun).toHaveBeenCalledExactlyOnceWith(
      w.input.actor,
      w.input.qRunId,
    );
    expect(w.questions).toHaveBeenCalledTimes(1);
    expect(w.createRun).toHaveBeenCalledTimes(1);
    const createdInput = z
      .object({ input: z.object({ conversationId: QConversationIdSchema }) })
      .parse(w.createRun.mock.calls[0]?.[0]);
    expect(createdInput.input.conversationId).toBe(w.conversationId);
    const card = w.propose.mock.calls[0]?.[0] as {
      actionType: string;
      payload: {
        relationshipId: string;
        input: { questions: string[]; about: { assumptionId: string }[] };
      };
    };
    expect(card.actionType).toBe("app.diligence.questions.send");
    expect(card.payload.relationshipId).toBe(relationshipId);
    expect(card.payload.input.questions).toHaveLength(2);
    expect(card.payload.input.about[1]?.assumptionId).toBe("MEMO_GAP:1");
    // The drafter saw the memo's gaps and the critic's finding.
    const drafted = w.questions.mock.calls[0]?.[2];
    expect(drafted?.gaps).toContain("Default rate on loans");
    expect(drafted?.critique).toContain("default rate is not addressed");
  });

  it("does not create an unrelated conversation when the original owned run is unavailable", async () => {
    const w = world();
    w.conversationForRun.mockRejectedValue(
      new Error("Original run inaccessible"),
    );
    await expect(w.diligence(w.input)).rejects.toThrow(
      "Original run inaccessible",
    );
    expect(w.createRun).not.toHaveBeenCalled();
    expect(w.propose).not.toHaveBeenCalled();
  });

  it("keeps the questions with the job when they are not connected, filing nothing", async () => {
    for (const state of [null, "INTEREST_EXPRESSED"]) {
      const w = world({ state });
      const result = await w.diligence(w.input);
      expect(result).toMatchObject({ status: "PREPARED" });
      expect(w.propose).not.toHaveBeenCalled();
      expect(w.createRun).not.toHaveBeenCalled();
    }
  });

  it("fails honestly when the questions cannot be drafted, and refuses what it may not read", async () => {
    const failed = world({ drafted: false });
    expect((await failed.diligence(failed.input)).status).toBe("FAILED");
    expect(failed.propose).not.toHaveBeenCalled();
    const denied = world({ authorised: false });
    expect((await denied.diligence(denied.input)).status).toBe("UNAVAILABLE");
    expect(denied.questions).not.toHaveBeenCalled();
  });
  it("rewrites only an overlong question once, preserving valid questions and their evidence gaps", async () => {
    const w = world();
    const long =
      "Could you provide the monthly cash burn for each of the last three months, clearly indicating the currency, reporting period and supporting financial records so we can assess the cash needs?";
    expect(long.length).toBeGreaterThan(180);
    const valid = {
      question: "What share of loans defaulted in the last two quarters?",
      about: "Default rate",
    };
    const repaired = {
      question:
        "What was monthly cash burn in each of the last three months, in which currency, and what records support it?",
      about: "Monthly burn",
    };
    w.questions
      .mockResolvedValueOnce({
        questions: [valid, { question: long, about: "Monthly burn" }],
      })
      .mockResolvedValueOnce({ questions: [repaired] });
    const result = await w.diligence(w.input);
    expect(result).toEqual({
      status: "CARDED",
      qActionId: "action-1",
      questions: [valid.question, repaired.question],
    });
    expect(w.questions).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(w.questions.mock.calls[1]?.[2].repairQuestions ?? "null"),
    ).toEqual([{ question: long, about: "Monthly burn" }]);
    expect(w.questions.mock.calls[1]?.[2].document).toBe(
      w.questions.mock.calls[0]?.[2].document,
    );
    expect(w.createRun).toHaveBeenCalledTimes(1);
  });

  it("repairs multiple invalid questions in one batch without reordering the valid middle question", async () => {
    const w = world();
    const longBurn = {
      question: "Please provide ".repeat(20),
      about: "Monthly burn",
    };
    const longDefaults = {
      question: "Please explain ".repeat(20),
      about: "Default rate",
    };
    const valid = {
      question: "How many paying customers are active this month?",
      about: "Paying customers",
    };
    const burn = {
      question: "What was monthly cash burn in each of the last three months?",
      about: "Monthly burn",
    };
    const defaults = {
      question:
        "What share of loans defaulted in each of the last two quarters?",
      about: "Default rate",
    };
    w.questions
      .mockResolvedValueOnce({ questions: [longBurn, valid, longDefaults] })
      .mockResolvedValueOnce({ questions: [burn, defaults] });
    expect(await w.diligence(w.input)).toEqual({
      status: "CARDED",
      qActionId: "action-1",
      questions: [burn.question, valid.question, defaults.question],
    });
    expect(w.questions).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(w.questions.mock.calls[1]?.[2].repairQuestions ?? "null"),
    ).toEqual([longBurn, longDefaults]);
  });

  it("fails before creating a card after repeated invalid output, refusal, changed gap or changed count", async () => {
    const long = {
      question: "Please provide ".repeat(20),
      about: "Monthly burn",
    };
    for (const repaired of [
      null,
      { questions: [long] },
      {
        questions: [
          { question: "What is the monthly burn?", about: "Unrelated gap" },
        ],
      },
      {
        questions: [
          { question: "What is the monthly burn?", about: "Monthly burn" },
          { question: "What is the monthly burn?", about: "Monthly burn" },
        ],
      },
    ]) {
      const w = world();
      w.questions
        .mockResolvedValueOnce({ questions: [long] })
        .mockResolvedValueOnce(repaired);
      expect((await w.diligence(w.input)).status).toBe("FAILED");
      expect(w.questions).toHaveBeenCalledTimes(2);
      expect(w.createRun).not.toHaveBeenCalled();
      expect(w.propose).not.toHaveBeenCalled();
    }
  });

  it("does not start repair or create an action after cancellation", async () => {
    const w = world();
    w.questions.mockResolvedValueOnce({
      questions: [
        { question: "Please provide ".repeat(20), about: "Monthly burn" },
      ],
    });
    const canContinue = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect((await w.diligence({ ...w.input, canContinue })).status).toBe(
      "UNAVAILABLE",
    );
    expect(w.questions).toHaveBeenCalledTimes(1);
    expect(w.createRun).not.toHaveBeenCalled();
    expect(w.propose).not.toHaveBeenCalled();
  });

  it("does not file questions if cancelled during repair", async () => {
    const w = world();
    w.questions
      .mockResolvedValueOnce({
        questions: [
          { question: "Please provide ".repeat(20), about: "Monthly burn" },
        ],
      })
      .mockResolvedValueOnce({
        questions: [
          { question: "What was monthly cash burn?", about: "Monthly burn" },
        ],
      });
    const canContinue = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect((await w.diligence({ ...w.input, canContinue })).status).toBe(
      "UNAVAILABLE",
    );
    expect(w.questions).toHaveBeenCalledTimes(2);
    expect(w.createRun).not.toHaveBeenCalled();
    expect(w.propose).not.toHaveBeenCalled();
  });
});
