import { describe, expect, it } from "vitest";

import type { OnboardingTranscriptReader } from "@capital-q/model-gateway/q";

import {
  LONG_ANSWER_DATASET,
  lintLongAnswerDataset,
  type LongAnswerCase,
} from "../src/datasets/onboarding-long-answer/index.js";
import { gradeLongAnswerCase } from "../src/graders/onboarding-long-answer.js";
import {
  readerLongAnswerSubject,
  runLongAnswer,
  scriptedLongAnswerSubject,
} from "../src/runner/onboarding-long-answer.js";

/**
 * ONBOARDING-LONG-ANSWER (onboarding P1-1, DECISIONS 77/72), scripted mode:
 * no network. The recorded/expected readings are graded by the same
 * deterministic graders a live run uses, so the graders and the code's
 * structural check (cleanedFromTheirLine) are exercised on every case.
 */
const byId = (id: string): LongAnswerCase => {
  const c = LONG_ANSWER_DATASET.cases.find((x) => x.id === id);
  if (c === undefined) throw new Error(id);
  return c;
};

describe("the dataset", () => {
  it("is sound: 40+ fictional cases, 30%+ held out, every curveball in both splits", () => {
    expect(lintLongAnswerDataset()).toEqual([]);
    const heldout = LONG_ANSWER_DATASET.cases.filter(
      (c) => c.split === "heldout",
    ).length;
    expect(LONG_ANSWER_DATASET.cases.length).toBeGreaterThanOrEqual(40);
    expect(heldout / LONG_ANSWER_DATASET.cases.length).toBeGreaterThanOrEqual(
      0.3,
    );
    expect(LONG_ANSWER_DATASET.synthetic).toBe(true);
  });
});

describe("scripted mode", () => {
  it("every recorded reading passes every grader, both splits (decision, code outcome, content)", async () => {
    const run = await runLongAnswer(
      scriptedLongAnswerSubject,
      LONG_ANSWER_DATASET.cases,
    );
    const misses = run.grades
      .filter((g) => !g.pass)
      .map((g) => `${g.caseId}/${g.stepKey}: ${g.reasons.join("; ")}`);
    expect(misses).toEqual([]);
    expect(run.summary.decisionAccuracy).toBe(1);
    expect(run.summary.outcomeAccuracy).toBe(1);
    expect(run.summary.unsafeSaves).toBe(0);
    expect(run.skipped).toEqual([]);
  });

  it("a spend cap stops the run before the next case", async () => {
    let calls = 0;
    const run = await runLongAnswer(
      (c) => {
        calls += 1;
        return scriptedLongAnswerSubject(c);
      },
      LONG_ANSWER_DATASET.cases,
      { stop: () => calls >= 3 },
    );
    expect(calls).toBe(3);
    expect(run.skipped.length).toBe(LONG_ANSWER_DATASET.cases.length - 3);
  });

  it("the reader subject shows only the case's steps and Q's line and theirs, and keeps string values", async () => {
    const seen: unknown[] = [];
    const reader: OnboardingTranscriptReader = {
      read: (input) => {
        seen.push(input);
        return Promise.resolve({
          answers: [
            {
              stepKey: "F1.description",
              value: "Payroll software for restaurants in Portugal.",
              quote: "Payroll software for restaurants in Portugal.",
              ownWords: true,
            },
          ],
          declined: [],
        });
      },
    };
    const c = byId("dev-short-clear-01");
    const reading = await readerLongAnswerSubject(reader, {
      tenantId: "t",
      userId: "u",
      correlationId: "c",
    })(c);
    expect(reading).toEqual([
      {
        stepKey: "F1.description",
        value: "Payroll software for restaurants in Portugal.",
        ownWords: true,
      },
    ]);
    expect(seen[0]).toMatchObject({
      journey: "founder",
      steps: [{ stepKey: "F1.description", kind: "LONG_TEXT" }],
      turns: [
        { role: "Q", text: c.asked },
        { role: "PERSON", text: c.said },
      ],
    });
  });
});

describe("the graders fail what they should (curveballs both ways)", () => {
  it("a clear answer summarised is a wrong decision and a needless read-back", () => {
    const c = byId("dev-typed-01");
    const [g] = gradeLongAnswerCase(c, [
      {
        stepKey: "F1.description",
        value: "Inventory software for independent bike shops.",
        ownWords: false,
      },
    ]);
    expect(g?.decisionExact).toBe(false);
    expect(g?.outcome).toBe("READ_BACK");
    expect(g?.pass).toBe(false);
  });

  it("a ramble kept in their words is a wrong decision and an unsafe save", () => {
    const c = byId("dev-short-ramble-01");
    const [g] = gradeLongAnswerCase(c, [
      { stepKey: "F1.description", value: c.said, ownWords: true },
    ]);
    expect(g?.decisionExact).toBe(false);
    expect(g?.outcome).toBe("SAVED");
    expect(g?.unsafeSave).toBe(true);
  });

  it("a keep that adds, rewords or reorders words is refused by the code check", () => {
    const c = byId("dev-correction-01");
    for (const value of [
      "We run a big marketplace for used lab equipment in the Benelux, so universities can sell instruments they no longer need to startups.",
      "We run a marketplace for second-hand lab equipment in the Benelux, so universities can sell instruments they no longer need to startups.",
      "We run a marketplace for used lab equipment in the Benelux, so startups can buy instruments universities no longer need.",
    ]) {
      const [g] = gradeLongAnswerCase(c, [
        { stepKey: "F1.description", value, ownWords: true },
      ]);
      expect(g?.decisionExact).toBe(true);
      expect(g?.outcome).toBe("READ_BACK");
      expect(g?.reasons).toContain("keep: not deletions only from their line");
      expect(g?.pass).toBe(false);
    }
  });

  it("a keep that cuts most of their line is a selection, not a cleaning", () => {
    const c = byId("dev-typed-01");
    const [g] = gradeLongAnswerCase(c, [
      {
        stepKey: "F1.description",
        value: "We build inventory software for independent bike shops.",
        ownWords: true,
      },
    ]);
    expect(g?.outcome).toBe("READ_BACK");
    expect(g?.pass).toBe(false);
  });

  it("a summary that drops a figure, is verbatim or is no shorter fails", () => {
    const c = byId("dev-figures-02");
    const grade = (value: string) =>
      gradeLongAnswerCase(c, [
        { stepKey: "F9.business_model", value, ownWords: false },
      ])[0];
    expect(
      grade(
        "Subscriptions at 49 pounds a month for the basic plan and 129 for the pro plan.",
      )?.reasons,
    ).toContain("summarise: dropped 1,200");
    expect(grade("49 a month, 49 pounds, for the basic")?.reasons).toContain(
      "summarise: their words verbatim",
    );
    expect(grade(`${c.said} In short: subscriptions.`)?.reasons).toContain(
      "summarise: not shorter than their line",
    );
    // "1200" and "1,200" are one figure.
    expect(
      grade(
        "Subscriptions at 49 pounds a month (basic) and 129 (pro), with about 1200 subscribers.",
      )?.pass,
    ).toBe(true);
  });

  it("a step left out fails", () => {
    const c = byId("dev-two-01");
    const grades = gradeLongAnswerCase(c, c.scripted.slice(0, 1));
    expect(grades.map((g) => g.pass)).toEqual([true, false]);
    expect(grades[1]?.decided).toBe("MISSING");
  });
});
