import { describe, expect, it } from "vitest";

import { createFakeModelProvider } from "@capital-q/model-gateway";

import {
  lintQIqDataset,
  Q_IQ_CATEGORIES,
  Q_IQ_DATASET,
  Q_IQ_WORLD,
  type QIqCase,
} from "../src/datasets/q-iq/index.js";
import { extractFigures, gradeQIqTurn } from "../src/graders/q-iq.js";
import {
  bareModelQIqSubject,
  runQIq,
  scriptedQIqSubject,
} from "../src/runner/q-iq.js";

/**
 * Q-IQ in CI (scripted mode only, no database, no provider): the dataset
 * is the fixed 150, the reference replies score 100%, and each
 * deterministic grader catches the failure it exists for.
 */

const find = (pred: (c: QIqCase) => boolean): QIqCase => {
  const found = Q_IQ_DATASET.cases.find(pred);
  if (found === undefined) throw new Error("no such case");
  return found;
};

describe("Q-IQ dataset", () => {
  it("is 150 multi-turn cases, 15 per category, structurally sound", () => {
    expect(lintQIqDataset()).toEqual([]);
    expect(Q_IQ_DATASET.cases).toHaveLength(150);
    for (const category of Q_IQ_CATEGORIES) {
      expect(
        Q_IQ_DATASET.cases.filter((c) => c.category === category),
      ).toHaveLength(15);
    }
    for (const c of Q_IQ_DATASET.cases) {
      expect(c.turns.length).toBeGreaterThanOrEqual(3);
      expect(c.turns.length).toBeLessThanOrEqual(8);
    }
  });

  it("has every behaviour the plan measures", () => {
    const behaviours = new Set(
      Q_IQ_DATASET.cases.flatMap((c) => c.turns.map((t) => t.expect.behaviour)),
    );
    expect([...behaviours].sort()).toEqual(["ANSWER", "CLARIFY", "UNKNOWN"]);
  });
});

describe("Q-IQ graders", () => {
  it("reads figures by value, not by rendering", () => {
    const values = extractFigures(
      "ARR is $2.4M, burn $180k a month, 2,300 merchants, 62% margin, raising 6 million (F3), since March 2024.",
    ).map((f) => f.value);
    expect(values).toEqual([2_400_000, 180_000, 2_300, 62, 6_000_000, 2024]);
  });

  it("the reference replies score 100% through the scripted subject", async () => {
    const result = await runQIq(scriptedQIqSubject(), Q_IQ_DATASET.cases);
    const failures = result.cases.flatMap((r) =>
      r.grade.turns
        .filter((t) => !t.pass)
        .map((t) => `${r.caseId}#${t.turn} ${t.reasons.join("; ")}`),
    );
    expect(failures).toEqual([]);
    expect(result.summary.overall.score).toBe(1);
    expect(result.summary.measures.wrongEntityTurns).toBe(0);
    expect(result.summary.measures.inventedFigureTurns).toBe(0);
    for (const category of Q_IQ_CATEGORIES) {
      expect(result.summary.byCategory[category].score, category).toBe(1);
    }
  });

  it("catches a wrong-entity answer (Ledgerline's figure for Ledgerfold)", () => {
    const c = find(
      (x) =>
        x.category === "CORRECTIONS" &&
        x.turns[1]?.user.includes("Ledgerfold") === true,
    );
    const grade = gradeQIqTurn(
      Q_IQ_WORLD,
      c,
      1,
      "Ledgerline burns $120k a month.",
    );
    expect(grade.pass).toBe(false);
    expect(grade.wrongEntity).toBe(true);
  });

  it("catches an invented figure", () => {
    const c = find((x) => x.category === "FOLLOW_UPS");
    const grade = gradeQIqTurn(
      Q_IQ_WORLD,
      c,
      0,
      `${c.turns[0]?.reference} Its NRR is 131%.`,
    );
    expect(grade.inventedFigures).toEqual([131]);
    expect(grade.pass).toBe(false);
  });

  it("catches unknown turned into zero, and unknown never said", () => {
    const c = find((x) => x.category === "UNKNOWN" && x.id.endsWith("079"));
    expect(c.turns[2]?.expect.behaviour).toBe("UNKNOWN");
    expect(gradeQIqTurn(Q_IQ_WORLD, c, 2, "Yes, it's zero.").pass).toBe(false);
    expect(
      gradeQIqTurn(Q_IQ_WORLD, c, 2, "Probably around 14 months.").pass,
    ).toBe(false);
    expect(
      gradeQIqTurn(
        Q_IQ_WORLD,
        c,
        2,
        "That isn't in the evidence, so I can't say.",
      ).pass,
    ).toBe(true);
  });

  it("passes a clarifying question and fails a guess", () => {
    const c = find(
      (x) =>
        x.category === "AMBIGUITY" &&
        x.turns[0]?.user === "What's Silo's runway?",
    );
    expect(
      gradeQIqTurn(Q_IQ_WORLD, c, 0, "Silo Credit or Silo Health?").pass,
    ).toBe(true);
    const guess = gradeQIqTurn(
      Q_IQ_WORLD,
      c,
      0,
      "Silo Credit has 14 months of runway.",
    );
    expect(guess.pass).toBe(false);
    expect(guess.clarified).toBe(false);
  });
});

describe("Q-IQ bare-model runner", () => {
  it("sends the facts and the raw conversation, and is graded the same way", async () => {
    const provider = createFakeModelProvider({
      code: "openai",
      script: [
        { kind: "TEXT", text: "Do you mean Silo Credit or Silo Health?" },
      ],
    });
    const subject = bareModelQIqSubject({
      provider,
      modelCode: "gpt-5.6-luna",
      price: {
        inputPerMillion: 0.2,
        cachedInputPerMillion: 0.02,
        outputPerMillion: 1.2,
      },
    });
    const c = find((x) => x.category === "AMBIGUITY");
    const result = await runQIq(subject, [c]);
    expect(result.cases[0]?.grade.turns[0]?.pass).toBe(true);
    const calls = provider.calls;
    expect(calls).toHaveLength(c.turns.length);
    const last = JSON.stringify(calls.at(-1));
    expect(last).toContain("Silo Credit annual recurring revenue");
    expect(last).toContain(c.turns[1]?.user.replace(/\.$/, "") ?? "");
  });
});
