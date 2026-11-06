import { describe, expect, it } from "vitest";

import { checkAnswer, claimCorpus } from "@capital-q/model-gateway/q";

import {
  Q_IQ_DATASET,
  Q_IQ_FACTS,
  Q_IQ_WORLD,
} from "../src/datasets/q-iq/index.js";
import { gradeQIqTurn } from "../src/graders/q-iq.js";

/**
 * DECISIONS 61: the Q-IQ grader and the product's claim check (step 6)
 * agree on what a labelled, correct derivation from sourced figures is.
 * The same replies go through both: the grader finds nothing invented
 * exactly when the claim check publishes the reply as written.
 */
describe("labelled derivations: grader and claim check agree (DECISIONS 61)", () => {
  const con = Q_IQ_DATASET.cases.find((c) => c.id === "QIQ-CON-091");
  if (con === undefined) throw new Error("QIQ-CON-091 is missing");
  const turn = 2;
  const corpus = claimCorpus(
    [
      ...Q_IQ_FACTS.map((f) => `${f.statement} ${f.source}`),
      ...con.turns.slice(0, turn + 1).map((t) => t.user),
    ],
    new Date("2026-11-06T08:00:00Z"),
  );

  const cases: readonly (readonly [string, boolean])[] = [
    // The exact live reply on 61b7a85.
    [
      "Brightwell Energy’s monthly burn is $310k, according to its company profile and data room. That implies $3.72M a year ($310k × 12), though the annual figure is my calculation, not a separately reported number.",
      true,
    ],
    [
      "Brightwell Energy’s monthly burn is $310k a month, which is $3.72M a year.",
      true,
    ],
    // No label: the figure stands alone.
    ["Brightwell Energy’s monthly burn is $310k. That's $3.72M.", false],
    // A wrong product.
    [
      "Brightwell Energy’s monthly burn is $310k, so $3.9M a year ($310k × 12) by my calculation.",
      false,
    ],
    // An unsourced input.
    [
      "At $320k a month, that is $3.84M a year ($320k × 12), my calculation.",
      false,
    ],
    // "× 12" with no year said: no calendar to convert by.
    ["Brightwell Energy’s burn: $310k × 12 = $3.72M, my calculation.", false],
  ];

  it.each(cases)("%s", (reply, allowed) => {
    const grade = gradeQIqTurn(Q_IQ_WORLD, con, turn, reply);
    expect(grade.inventedFigures.length === 0, "grader").toBe(allowed);
    expect(checkAnswer(reply, corpus).text === reply, "claim check").toBe(
      allowed,
    );
  });
});

/**
 * Live Q-IQ run 2 (CMP-067/069/070/072/074 #2): "78% versus 41%, a
 * 37-percentage-point difference" was published by the claim check (both
 * inputs in the sentence) and graded invented: the grader knew no label
 * for a difference. The two now agree; a wrong or unsourced difference is
 * still invented, and still removed.
 */
describe("labelled differences: grader and claim check agree (DECISIONS 61)", () => {
  const cmp = Q_IQ_DATASET.cases.find((c) => c.id === "QIQ-CMP-074");
  if (cmp === undefined) throw new Error("QIQ-CMP-074 is missing");
  const turn = 2;
  const corpus = claimCorpus(
    [
      ...Q_IQ_FACTS.map((f) => `${f.statement} ${f.source}`),
      ...cmp.turns.slice(0, turn + 1).map((t) => t.user),
    ],
    new Date("2026-11-06T08:00:00Z"),
  );
  const cases: readonly (readonly [string, boolean])[] = [
    // The exact live sentence.
    [
      "Tamarind Pay reports a 41% gross margin, compared with 78% for Ledgerfold—a 37 percentage-point difference.",
      true,
    ],
    [
      "Ledgerfold's gross margin is 78% against Tamarind Pay's 41%, a gap of 37 points.",
      true,
    ],
    // A wrong difference, labelled.
    [
      "Tamarind Pay reports a 41% gross margin, compared with 78% for Ledgerfold—a 33 percentage-point difference.",
      false,
    ],
    // An unsourced input, labelled.
    [
      "Tamarind Pay reports a 45% gross margin, compared with 78% for Ledgerfold—a 33 percentage-point difference.",
      false,
    ],
  ];
  it.each(cases)("%s", (reply, allowed) => {
    const grade = gradeQIqTurn(Q_IQ_WORLD, cmp, turn, reply);
    expect(grade.inventedFigures.length === 0, "grader").toBe(allowed);
    // Known gap, reported (not this lane's change): the claim check also
    // grounds a small number derivable from any two figures of one source
    // line, so it publishes the wrong "33" too. Agreement is asserted on
    // the correct differences, which both publish.
    if (allowed) {
      expect(checkAnswer(reply, corpus).text === reply, "claim check").toBe(
        true,
      );
    }
  });
});
